import { createServerFn } from "@tanstack/react-start";
import { resolveAirtableConfig } from "../production-adapter/airtable-rest-source";
import { basketApprovalFingerprint } from "./approval";
import { BASKET_CANDIDATES_TABLE_ID, readCanonicalBasketForShop } from "./canonical-basket";
import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";

export const PRESENT_APPROVED_BASKET_POLICY = "present-approved-basket:v1" as const;
export const PRESENT_APPROVED_BASKET_POLICY_VERSION = 1 as const;

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

type ApprovalResult =
  | { status: "APPROVED"; basketId: string; approvalId: string; approvedAt: string; approvedBy: string }
  | { status: "REFUSED"; detail: string };

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
}

function envFromRuntime(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> =
    typeof process === "undefined" ? {} : { ...(process.env as Record<string, string | undefined>) };
  return env;
}

function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function readPendingRow(
  config: { apiKey: string; baseId: string },
  basketId: string,
  fetchImpl: FetchLike,
): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const params = new URLSearchParams();
  params.set("pageSize", "10");
  params.set(
    "filterByFormula",
    `AND({Basket} = '${escapeFormulaValue(basketId)}',{Approval status}='PENDING')`,
  );
  params.append("fields[]", "Basket");
  params.append("fields[]", "Approval status");
  params.append("Basket payload");
  params.append("fields[]", "Basket fingerprint");
  params.append("fields[]", "Judge ID");
  params.append("fields[]", "Basket version");
  const url = `https://api.airtable.com/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}?${params.toString()}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Airtable basket approval read failed [${response.status}]: ${await response.text()}`);
  }
  const payload = (await response.json()) as AirtableListResponse;
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (records.length !== 1) return null;
  const record = records[0];
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    fields: record.fields && typeof record.fields === "object" ? (record.fields as Record<string, unknown>) : {},
  };
}

export const approveCanonicalBasketForShop = createServerFn({ method: "POST" })
  .handler(async (): Promise<ApprovalResult> => {
    const env = envFromRuntime();
    try {
      const workers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
      for (const [key, value] of Object.entries(workers.env ?? {})) {
        if (typeof value === "string") env[key] = value;
      }
    } catch {
      // Local/test execution uses process.env.
    }

    const resolution = resolveAirtableConfig(env);
    if (resolution.status !== "CONFIGURED") {
      return { status: "REFUSED", detail: `Airtable connector not configured (missing: ${resolution.missing.join(", ")}).` };
    }

    const fetchImpl = fetch as unknown as FetchLike;
    const read = await readCanonicalBasketForShop(env, fetchImpl, new Date().toISOString());
    if (read.status !== "READY") return { status: "REFUSED", detail: read.detail };
    if (read.approval.status !== "PENDING") return { status: "REFUSED", detail: "The canonical basket is no longer pending human approval." };

    const basket: CandidateBasket = read.basket;
    if (!basket.complete || !basket.readyForApproval) {
      return { status: "REFUSED", detail: "The canonical basket is not approval-ready. Resolve its procurement exceptions first; FoodOS will not approve an incomplete or exception-bearing basket." };
    }

    const judge = judgeCandidateBasket(basket);
    if (judge.verdict !== "PASS" || !judge.readyForApproval) {
      return { status: "REFUSED", detail: `Basket judge did not pass: ${judge.reasons.join(" | ")}` };
    }

    const pending = await readPendingRow(
      { apiKey: resolution.config.apiKey, baseId: resolution.config.baseId },
      basket.basketId,
      fetchImpl,
    );
    if (!pending) {
      return { status: "REFUSED", detail: "The exact pending basket row could not be uniquely located; refusing to guess." };
    }

    const storedFingerprint = typeof pending.fields["Basket fingerprint"] === "string" ? pending.fields["Basket fingerprint"] : "";
    const computedFingerprint = basketApprovalFingerprint(basket);
    if (storedFingerprint !== computedFingerprint) {
      return { status: "REFUSED", detail: "The canonical basket fingerprint does not match its serialized payload; refusing approval." };
    }

    const now = new Date().toISOString();
    const approvalId = `present-approved-basket-${crypto.randomUUID()}`;
    const fields = {
      "Approval status": "APPROVED",
      "Approval ID": approvalId,
      "Basket version": 1,
      "Basket fingerprint": computedFingerprint,
      "Approved at": now,
      "Approved by": "James",
      "Approval policy identity": PRESENT_APPROVED_BASKET_POLICY,
      "Approval policy version": PRESENT_APPROVED_BASKET_POLICY_VERSION,
      "Judge ID": judge.judgeId,
    };

    const url = `https://api.airtable.com/v0/${encodeURIComponent(resolution.config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}/${encodeURIComponent(pending.id)}`;
    const response = await fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${resolution.config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: false }),
    });
    if (!response.ok) {
      return { status: "REFUSED", detail: `Airtable basket approval write failed [${response.status}]: ${await response.text()}` };
    }

    const verified = await readCanonicalBasketForShop(env, fetchImpl, now);
    if (verified.status !== "READY" || verified.approval.status !== "APPROVED") {
      return { status: "REFUSED", detail: "Approval write completed but the canonical Shop read did not verify the exact approved basket; refusing to report success." };
    }

    return {
      status: "APPROVED",
      basketId: basket.basketId,
      approvalId,
      approvedAt: now,
      approvedBy: "James",
    };
  });
