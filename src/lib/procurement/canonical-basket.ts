import {
  AIRTABLE_API_URL,
  type FetchLike,
  resolveAirtableConfig,
} from "../production-adapter/airtable-rest-source";
import { validateBasketApproval, type BasketApproval } from "./approval";
import type { CandidateBasket } from "./types";

export const BASKET_CANDIDATES_TABLE_ID = "tblfnApCRftISnKJv";

export const BASKET_CANDIDATES_FIELDS = [
  "Basket",
  "Run",
  "Retailer",
  "Estimated total",
  "Coverage",
  "Substitutions",
  "Convenience score",
  "Value score",
  "Waste risk",
  "Product links verified",
  "Key trade-offs",
  "Judge verdict",
  "Reason for verdict",
  "Approval status",
  "Approval ID",
  "Basket version",
  "Basket fingerprint",
  "Approved at",
  "Approved by",
  "Basket payload",
  "Judge ID",
  "Approval policy identity",
  "Approval policy version",
] as const;

const MAX_PAGES = 10;
const PAGE_SIZE = 100;

export interface CanonicalBasketApprovalView {
  approvalId: string;
  basketVersion: number;
  basketFingerprint: string;
  judgeId: string;
  policyIdentity: string;
  policyVersion: number;
  approvedAt: string;
  approvedBy: string;
}

export type CanonicalBasketReadResult =
  | {
      status: "READY";
      source: "AIRTABLE_CANONICAL";
      basket: CandidateBasket;
      approval: CanonicalBasketApprovalView;
    }
  | {
      status: "NOT_READY";
      source: "AIRTABLE_CANONICAL" | "UNAVAILABLE";
      reason:
        | "NO_APPROVED_BASKET"
        | "AMBIGUOUS_APPROVED_BASKETS"
        | "BASKET_PAYLOAD_INVALID"
        | "APPROVAL_PROVENANCE_INVALID"
        | "CONNECTOR_NOT_CONFIGURED"
        | "CONNECTOR_READ_FAILED";
      detail: string;
    };

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
  offset?: unknown;
}

function readString(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildBasketUrl(baseId: string, tableId: string, offset?: string): string {
  const params = new URLSearchParams();
  params.set("pageSize", String(PAGE_SIZE));
  params.set("filterByFormula", "AND({Approval status}='APPROVED',{Basket payload}!='')");
  for (const field of BASKET_CANDIDATES_FIELDS) params.append("fields[]", field);
  if (offset) params.set("offset", offset);
  return `${AIRTABLE_API_URL}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`;
}

async function listApprovedRows(
  config: { apiKey: string; baseId: string },
  fetchImpl: FetchLike,
): Promise<{ records: { id: string; fields: Record<string, unknown> }[] }> {
  const records: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchImpl(buildBasketUrl(config.baseId, BASKET_CANDIDATES_TABLE_ID, offset), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable BASKET CANDIDATES read failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as AirtableListResponse;
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error("Airtable BASKET CANDIDATES read returned no records array; refusing to guess.");
    }
    for (const record of payload.records) {
      if (typeof record.id !== "string") {
        throw new Error("Airtable BASKET CANDIDATES row is missing its record id; refusing partial read.");
      }
      records.push({
        id: record.id,
        fields:
          record.fields && typeof record.fields === "object"
            ? (record.fields as Record<string, unknown>)
            : {},
      });
    }
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return { records };
  }

  throw new Error(`Airtable BASKET CANDIDATES read exceeded ${MAX_PAGES} pages; refusing partial state.`);
}

function parseCandidateBasket(raw: string): CandidateBasket | null {
  try {
    const parsed = JSON.parse(raw) as CandidateBasket;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.basketId !== "string" || typeof parsed.planId !== "string") return null;
    if (!Array.isArray(parsed.lines) || !Array.isArray(parsed.exceptions)) return null;
    if (!parsed.coverage || typeof parsed.coverage !== "object") return null;
    if (typeof parsed.totalCost !== "number" || !Number.isFinite(parsed.totalCost)) return null;
    if (parsed.dispatched !== false || parsed.requiresHumanApproval !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseApproval(fields: Record<string, unknown>, basketId: string): BasketApproval | null {
  const approvalId = readString(fields, "Approval ID");
  const basketFingerprint = readString(fields, "Basket fingerprint");
  const judgeId = readString(fields, "Judge ID");
  const policyIdentity = readString(fields, "Approval policy identity");
  const approvedAt = readString(fields, "Approved at");
  const approvedBy = readString(fields, "Approved by");
  const basketVersion = readFiniteNumber(fields, "Basket version");
  const policyVersion = readFiniteNumber(fields, "Approval policy version");
  if (
    !approvalId ||
    !basketFingerprint ||
    !judgeId ||
    !policyIdentity ||
    !approvedAt ||
    !approvedBy ||
    basketVersion === null ||
    policyVersion === null
  ) {
    return null;
  }

  return {
    approvalId,
    basketId,
    basketVersion,
    basketFingerprint,
    judgeId,
    policyIdentity: policyIdentity as BasketApproval["policyIdentity"],
    policyVersion: policyVersion as BasketApproval["policyVersion"],
    status: "APPROVED",
    approvedAt,
    approvedBy,
  };
}

/**
 * Read exactly one approved basket from the canonical control plane.
 *
 * This is deliberately read-only and fail-closed. A judge PASS is not enough:
 * the row must carry a complete serialized basket plus the exact approval
 * identity/version/fingerprint/judge/provenance metadata required by the
 * deterministic approval validator.
 */
export async function readCanonicalApprovedBasket(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike,
  now = new Date().toISOString(),
): Promise<CanonicalBasketReadResult> {
  const resolution = resolveAirtableConfig(env);
  if (resolution.status !== "CONFIGURED") {
    return {
      status: "NOT_READY",
      source: "UNAVAILABLE",
      reason: "CONNECTOR_NOT_CONFIGURED",
      detail: `Airtable connector not configured (missing: ${resolution.missing.join(", ")}).`,
    };
  }

  try {
    const { records } = await listApprovedRows(
      { apiKey: resolution.config.apiKey, baseId: resolution.config.baseId },
      fetchImpl,
    );

    if (records.length === 0) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "NO_APPROVED_BASKET",
        detail: "BASKET CANDIDATES contains no row with Approval status=APPROVED and a canonical Basket payload.",
      };
    }

    if (records.length !== 1) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "AMBIGUOUS_APPROVED_BASKETS",
        detail: `BASKET CANDIDATES contains ${records.length} approved basket rows; exactly one is required for the Shop approval surface.`,
      };
    }

    const fields = records[0].fields;
    const payload = readString(fields, "Basket payload");
    const basket = payload ? parseCandidateBasket(payload) : null;
    if (!basket) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "BASKET_PAYLOAD_INVALID",
        detail: "The approved row does not contain a valid serialized CandidateBasket payload.",
      };
    }

    const approval = parseApproval(fields, basket.basketId);
    if (!approval) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "APPROVAL_PROVENANCE_INVALID",
        detail: "The approved row is missing one or more approval identity, version, fingerprint, judge or human-provenance fields.",
      };
    }

    const validation = validateBasketApproval(approval, basket, now);
    if (!validation.valid) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "APPROVAL_PROVENANCE_INVALID",
        detail: `Canonical basket approval failed validation: ${validation.reason}.`,
      };
    }

    const retailer = readString(fields, "Retailer");
    const estimatedTotal = readFiniteNumber(fields, "Estimated total");
    if (retailer !== basket.retailer || estimatedTotal !== basket.totalCost) {
      return {
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason: "APPROVAL_PROVENANCE_INVALID",
        detail: "The canonical row summary does not exactly match the serialized basket payload.",
      };
    }

    return {
      status: "READY",
      source: "AIRTABLE_CANONICAL",
      basket,
      approval: {
        approvalId: approval.approvalId,
        basketVersion: approval.basketVersion,
        basketFingerprint: approval.basketFingerprint,
        judgeId: approval.judgeId,
        policyIdentity: approval.policyIdentity,
        policyVersion: approval.policyVersion,
        approvedAt: approval.approvedAt!,
        approvedBy: approval.approvedBy!,
      },
    };
  } catch (error) {
    return {
      status: "NOT_READY",
      source: "AIRTABLE_CANONICAL",
      reason: "CONNECTOR_READ_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
