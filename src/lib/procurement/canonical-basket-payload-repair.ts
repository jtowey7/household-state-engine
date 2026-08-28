import { basketApprovalFingerprint, validateBasketApproval, type BasketApproval } from "./approval";
import { judgeCandidateBasket } from "./judge";
import { BASKET_CANDIDATES_TABLE_ID } from "./canonical-basket";
import type { CandidateBasket } from "./types";

export interface CanonicalBasketPayloadRepairConfig {
  apiKey: string;
  baseId: string;
  apiUrl?: string;
}

export type CanonicalBasketPayloadRepairFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export type CanonicalBasketPayloadRepairResult =
  | { status: "REPAIRED"; recordId: string; basketId: string; fingerprint: string }
  | { status: "NO_OP"; recordId: string; basketId: string }
  | { status: "REFUSED"; detail: string };

type AirtableRecord = { id?: unknown; fields?: unknown };
type AirtableResponse = { records?: AirtableRecord[] };

const REPAIR_FIELDS = [
  "Basket",
  "Approval status",
  "Approval ID",
  "Basket version",
  "Basket fingerprint",
  "Approved at",
  "Approved by",
  "Judge ID",
  "Approval policy identity",
  "Approval policy version",
  "Basket payload",
] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readString(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return nonEmpty(value) ? value.trim() : undefined;
}

function readNumber(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function listUrl(config: CanonicalBasketPayloadRepairConfig, basketId: string): string {
  const params = new URLSearchParams();
  params.set("pageSize", "10");
  params.set("filterByFormula", `{Basket} = '${escapeFormulaValue(basketId)}'`);
  for (const field of REPAIR_FIELDS) params.append("fields[]", field);
  return `${config.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}?${params.toString()}`;
}

function updateUrl(config: CanonicalBasketPayloadRepairConfig, recordId: string): string {
  return `${config.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}/${encodeURIComponent(recordId)}`;
}

function authHeaders(config: CanonicalBasketPayloadRepairConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function parseApprovedRow(record: AirtableRecord): { id: string; approval: BasketApproval; payload?: string } | null {
  if (!nonEmpty(record.id) || !record.fields || typeof record.fields !== "object") return null;
  const fields = record.fields as Record<string, unknown>;
  if (readString(fields, "Approval status") !== "APPROVED") return null;
  const basketId = readString(fields, "Basket");
  const approvalId = readString(fields, "Approval ID");
  const fingerprint = readString(fields, "Basket fingerprint");
  const judgeId = readString(fields, "Judge ID");
  const policyIdentity = readString(fields, "Approval policy identity");
  const approvedAt = readString(fields, "Approved at");
  const approvedBy = readString(fields, "Approved by");
  const basketVersion = readNumber(fields, "Basket version");
  const policyVersion = readNumber(fields, "Approval policy version");
  if (!basketId || !approvalId || !fingerprint || !judgeId || !policyIdentity || !approvedAt || !approvedBy || basketVersion === undefined || policyVersion === undefined) return null;
  return {
    id: record.id as string,
    approval: {
      approvalId,
      basketId,
      basketVersion,
      basketFingerprint: fingerprint,
      judgeId,
      policyIdentity: policyIdentity as BasketApproval["policyIdentity"],
      policyVersion: policyVersion as BasketApproval["policyVersion"],
      status: "APPROVED",
      approvedAt,
      approvedBy,
    },
    payload: readString(fields, "Basket payload"),
  };
}

/**
 * Repair-only write boundary for a canonical basket that already has valid
 * approval provenance but an incomplete/invalid serialized payload.
 *
 * The repair is deliberately narrower than candidate creation: it can only
 * replace Basket payload after the exact basket fingerprint, judge result and
 * complete human approval provenance all validate against the supplied basket.
 * It never changes approval fields, basket identity/version, or retailer state.
 */
export async function repairCanonicalBasketPayload(
  config: CanonicalBasketPayloadRepairConfig,
  basket: CandidateBasket,
  fetchImpl: CanonicalBasketPayloadRepairFetch,
  now = new Date().toISOString(),
): Promise<CanonicalBasketPayloadRepairResult> {
  if (!basket.complete || !basket.readyForApproval || basket.dispatched !== false || basket.requiresHumanApproval !== true) {
    return { status: "REFUSED", detail: "BASKET_NOT_REPAIRABLE" };
  }
  const judge = judgeCandidateBasket(basket);
  if (judge.verdict !== "PASS" || !judge.readyForApproval) {
    return { status: "REFUSED", detail: `BASKET_JUDGE_${judge.verdict}` };
  }
  const fingerprint = basketApprovalFingerprint(basket);

  try {
    const response = await fetchImpl(listUrl(config, basket.basketId), {
      method: "GET",
      headers: authHeaders(config),
    });
    if (!response.ok) {
      return { status: "REFUSED", detail: `Airtable BASKET CANDIDATES read failed [${response.status}]: ${await response.text()}` };
    }
    const payload = (await response.json()) as AirtableResponse;
    if (!Array.isArray(payload.records)) return { status: "REFUSED", detail: "BASKET_REPAIR_READ_INVALID" };
    if (payload.records.length !== 1) {
      return { status: "REFUSED", detail: `BASKET_ID_AMBIGUOUS: expected exactly one row for Basket ${basket.basketId}, found ${payload.records.length}.` };
    }

    const row = parseApprovedRow(payload.records[0]!);
    if (!row) return { status: "REFUSED", detail: "APPROVAL_PROVENANCE_INVALID" };
    if (row.approval.basketFingerprint !== fingerprint) {
      return { status: "REFUSED", detail: `BASKET_ID_FINGERPRINT_CONFLICT: Basket ${basket.basketId} has a different stored fingerprint.` };
    }
    if (row.approval.judgeId !== judge.judgeId) return { status: "REFUSED", detail: "JUDGE_RESULT_CHANGED" };
    const approvalValidation = validateBasketApproval(row.approval, basket, now);
    if (!approvalValidation.valid) return { status: "REFUSED", detail: `APPROVAL_PROVENANCE_INVALID: ${approvalValidation.reason}` };

    if (row.payload === JSON.stringify(basket)) {
      return { status: "NO_OP", recordId: row.id, basketId: basket.basketId };
    }

    const update = await fetchImpl(updateUrl(config, row.id), {
      method: "PATCH",
      headers: authHeaders(config),
      body: JSON.stringify({ fields: { "Basket payload": JSON.stringify(basket) }, typecast: false }),
    });
    if (!update.ok) {
      return { status: "REFUSED", detail: `Airtable BASKET CANDIDATES repair failed [${update.status}]: ${await update.text()}` };
    }

    const updated = (await update.json()) as AirtableRecord;
    const updatedFields = updated.fields && typeof updated.fields === "object" ? updated.fields as Record<string, unknown> : {};
    const returnedFingerprint = readString(updatedFields, "Basket fingerprint");
    if (returnedFingerprint && returnedFingerprint !== fingerprint) {
      return { status: "REFUSED", detail: "BASKET_REPAIR_FINGERPRINT_CONFLICT" };
    }
    const returnedPayload = readString(updatedFields, "Basket payload");
    if (returnedPayload !== JSON.stringify(basket)) {
      return { status: "REFUSED", detail: "BASKET_REPAIR_PAYLOAD_NOT_VERIFIED" };
    }
    return { status: "REPAIRED", recordId: row.id, basketId: basket.basketId, fingerprint };
  } catch (error) {
    return { status: "REFUSED", detail: error instanceof Error ? error.message : String(error) };
  }
}
