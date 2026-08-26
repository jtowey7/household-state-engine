import { createBasketApproval, basketApprovalFingerprint } from "./approval";
import { judgeCandidateBasket } from "./judge";
import { BASKET_CANDIDATES_TABLE_ID } from "./canonical-basket";
import type { CandidateBasket } from "./types";

/**
 * Narrow production writer for canonical basket proposals.
 *
 * SAFETY BOUNDARY:
 * - writes only BASKET CANDIDATES;
 * - requires an exact, complete, approval-ready basket;
 * - requires the deterministic basket judge to PASS;
 * - creates PENDING approval provenance only — never APPROVED;
 * - is idempotent on Basket ID;
 * - never writes household state, shopping orders, inventory or retailer checkout.
 */

export const CANONICAL_BASKET_WRITABLE_TABLE = "BASKET CANDIDATES" as const;

export const CANONICAL_BASKET_ENV_KEYS = {
  apiKey: "AIRTABLE_API_KEY",
  baseId: "AIRTABLE_FOOD_OS_BASE_ID",
} as const;

export interface CanonicalBasketWriterConfig {
  apiKey: string;
  baseId: string;
  apiUrl?: string;
}

export type CanonicalBasketWriterFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export type CanonicalBasketPersistResult =
  | { status: "PERSISTED"; recordId: string; basketId: string; approvalId: string }
  | { status: "DEDUPLICATED"; recordId: string; basketId: string }
  | { status: "REFUSED"; detail: string };

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
}

function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function assertBasketWriteInvariant(basket: CandidateBasket): void {
  if (!basket || typeof basket !== "object") throw new Error("BASKET_REQUIRED");
  if (!basket.complete || !basket.readyForApproval) {
    throw new Error("BASKET_NOT_APPROVAL_READY");
  }
  if (basket.dispatched !== false || basket.requiresHumanApproval !== true) {
    throw new Error("BASKET_BOUNDARY_INVARIANT_FAILED");
  }
  if (!basket.basketId.trim() || !basket.planId.trim() || !basket.replayId.trim()) {
    throw new Error("BASKET_PROVENANCE_ID_REQUIRED");
  }
  if (!Number.isFinite(basket.totalCost) || basket.totalCost < 0) {
    throw new Error("BASKET_TOTAL_INVALID");
  }
  if (basket.coverage.demandItemKeys.length === 0 || !basket.coverage.complete) {
    throw new Error("BASKET_COVERAGE_INCOMPLETE");
  }
  if (basket.coverage.unsourcedItemKeys.length > 0) {
    throw new Error("BASKET_HAS_UNSOURCED_ITEMS");
  }
  if (basket.exceptions.length > 0) {
    throw new Error("BASKET_HAS_EXCEPTIONS");
  }
}

function buildListUrl(config: CanonicalBasketWriterConfig, basketId: string): string {
  const params = new URLSearchParams();
  params.set("pageSize", "10");
  params.set("filterByFormula", `{Basket} = '${escapeFormulaValue(basketId)}'`);
  params.append("fields[]", "Basket");
  return `${config.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}?${params.toString()}`;
}

function buildCreateUrl(config: CanonicalBasketWriterConfig): string {
  return `${config.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}`;
}

function headers(config: CanonicalBasketWriterConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function listExisting(
  config: CanonicalBasketWriterConfig,
  basketId: string,
  fetchImpl: CanonicalBasketWriterFetch,
): Promise<{ id: string }[]> {
  const response = await fetchImpl(buildListUrl(config, basketId), {
    method: "GET",
    headers: headers(config),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airtable BASKET CANDIDATES read failed [${response.status}]: ${body}`);
  }
  const payload = (await response.json()) as AirtableListResponse;
  if (!payload || !Array.isArray(payload.records)) {
    throw new Error("Airtable BASKET CANDIDATES read returned no records array; refusing to guess.");
  }
  return payload.records
    .map((record) => (typeof record.id === "string" ? { id: record.id } : null))
    .filter((record): record is { id: string } => record !== null);
}

function coveragePercent(basket: CandidateBasket): number {
  const demanded = basket.coverage.demandItemKeys.length;
  return demanded === 0 ? 0 : Math.round((basket.coverage.sourcedItemKeys.length / demanded) * 100) / 100;
}

function buildFields(
  basket: CandidateBasket,
  runId: string,
  approvalId: string,
  basketFingerprint: string,
  judgeId: string,
  judgeReasons: string[],
  tradeoffs: string[],
): Record<string, unknown> {
  return {
    Basket: basket.basketId,
    Run: runId,
    Retailer: basket.retailer ?? "",
    "Estimated total": basket.totalCost,
    Coverage: coveragePercent(basket),
    Substitutions: 0,
    "Key trade-offs": tradeoffs.join("\n"),
    "Judge verdict": "PASS",
    "Reason for verdict": judgeReasons.join("\n"),
    "Approval status": "PENDING",
    "Approval ID": approvalId,
    "Basket version": 1,
    "Basket fingerprint": basketFingerprint,
    "Basket payload": JSON.stringify(basket),
    "Judge ID": judgeId,
    "Approval policy identity": "submit-grocery-order:v1",
    "Approval policy version": 1,
  };
}

/**
 * Persist one real candidate basket after all pre-approval gates have passed.
 * This function deliberately has no APPROVED or dispatch path.
 */
export async function persistCanonicalBasketCandidate(
  config: CanonicalBasketWriterConfig,
  basket: CandidateBasket,
  fetchImpl: CanonicalBasketWriterFetch,
  runId = basket.planId,
): Promise<CanonicalBasketPersistResult> {
  try {
    assertBasketWriteInvariant(basket);
  } catch (error) {
    return { status: "REFUSED", detail: error instanceof Error ? error.message : String(error) };
  }

  const judge = judgeCandidateBasket(basket);
  if (judge.verdict !== "PASS" || !judge.readyForApproval) {
    return {
      status: "REFUSED",
      detail: `BASKET_JUDGE_${judge.verdict}: ${judge.reasons.join(" | ")}`,
    };
  }

  const approval = createBasketApproval(basket, 1);
  const fingerprint = basketApprovalFingerprint(basket);

  try {
    const existing = await listExisting(config, basket.basketId, fetchImpl);
    if (existing.length > 1) {
      return {
        status: "REFUSED",
        detail: `BASKET_ID_AMBIGUOUS: ${existing.length} existing BASKET CANDIDATES rows share Basket ${basket.basketId}.`,
      };
    }
    if (existing.length === 1) {
      return { status: "DEDUPLICATED", recordId: existing[0]!.id, basketId: basket.basketId };
    }

    const response = await fetchImpl(buildCreateUrl(config), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        records: [{
          fields: buildFields(
            basket,
            runId,
            approval.approvalId,
            fingerprint,
            judge.judgeId,
            judge.reasons,
            judge.tradeoffs,
          ),
        }],
        typecast: false,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable BASKET CANDIDATES write failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as AirtableListResponse;
    const recordId = payload.records?.[0]?.id;
    if (typeof recordId !== "string") {
      throw new Error("Airtable BASKET CANDIDATES write returned no record id; refusing to report persistence.");
    }
    return { status: "PERSISTED", recordId, basketId: basket.basketId, approvalId: approval.approvalId };
  } catch (error) {
    return { status: "REFUSED", detail: error instanceof Error ? error.message : String(error) };
  }
}
