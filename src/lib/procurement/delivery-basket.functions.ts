import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseStatus } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "../operator-read-auth";
import { hashOf } from "../state-engine/hash";
import { basketApprovalFingerprint, type BasketApproval } from "./approval";
import { PRESENT_APPROVED_BASKET_POLICY } from "./canonical-basket";
import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";

const AIRTABLE_URL = "https://api.airtable.com";
const BASKET_CANDIDATES_TABLE_ID = "tblfnApCRftISnKJv";
const PRESENT_APPROVED_BASKET_POLICY_VERSION = 1;

export type DeliveryBasketRead =
  | { status: "READY"; basket: CandidateBasket; approval: { status: "PENDING" | "APPROVED"; approvalId?: string; basketVersion: number; basketFingerprint: string; judgeId: string; approvedAt?: string; approvedBy?: string }; reviewRequired: boolean }
  | { status: "NOT_READY"; detail: string };

export type DeliveryBasketApprovalResult =
  | { ok: true; approvalId: string; basketId: string }
  | { ok: false; detail: string };

interface AirtableRecord { id?: unknown; fields?: unknown; }
interface AirtableListResponse { records?: AirtableRecord[]; }
type AirtableRow = { id: string; fields: Record<string, unknown> };

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function readString(fields: Record<string, unknown>, key: string): string | undefined { const value = fields[key]; return nonEmpty(value) ? value.trim() : undefined; }
function readNumber(fields: Record<string, unknown>, key: string): number | undefined { const value = fields[key]; return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function escapeFormulaValue(value: string): string { return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

function listUrl(baseId: string, basketId?: string): string {
  const params = new URLSearchParams();
  params.set("pageSize", "10");
  params.set("filterByFormula", basketId ? `AND({Basket} = '${escapeFormulaValue(basketId)}',OR({Approval status}='PENDING',{Approval status}='APPROVED'),{Basket payload}!='')` : "AND(OR({Approval status}='PENDING',{Approval status}='APPROVED'),{Basket payload}!='')");
  for (const field of ["Basket", "Retailer", "Estimated total", "Judge verdict", "Approval status", "Approval ID", "Basket version", "Basket fingerprint", "Approved at", "Approved by", "Basket payload", "Judge ID", "Approval policy identity", "Approval policy version"]) params.append("fields[]", field);
  return `${AIRTABLE_URL}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}?${params.toString()}`;
}
function recordUrl(baseId: string, recordId: string): string { return `${AIRTABLE_URL}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(BASKET_CANDIDATES_TABLE_ID)}/${encodeURIComponent(recordId)}`; }
function headers(apiKey: string): Record<string, string> { return { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" }; }

function parseBasket(raw: unknown): CandidateBasket | null {
  if (typeof raw !== "string") return null;
  try {
    const basket = JSON.parse(raw) as CandidateBasket;
    if (!basket || typeof basket !== "object") return null;
    if (typeof basket.basketId !== "string" || typeof basket.planId !== "string") return null;
    if (!Array.isArray(basket.lines) || !Array.isArray(basket.exceptions)) return null;
    if (!basket.coverage || typeof basket.coverage !== "object") return null;
    if (basket.dispatched !== false || basket.requiresHumanApproval !== true) return null;
    return basket;
  } catch { return null; }
}

function approvalId(approval: Pick<BasketApproval, "basketId" | "basketVersion" | "basketFingerprint" | "judgeId" | "policyIdentity" | "policyVersion" | "approvedAt" | "approvedBy">): string {
  return hashOf({
    basketId: approval.basketId,
    basketVersion: approval.basketVersion,
    fingerprint: approval.basketFingerprint,
    judgeId: approval.judgeId,
    policyIdentity: approval.policyIdentity,
    policyVersion: approval.policyVersion,
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
  });
}

async function runtimeEnvironment(): Promise<Record<string, string | undefined>> {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) if (typeof value === "string") cloudflareEnv[key] = value;
  } catch { /* local/test fallback */ }
  return { ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)), ...cloudflareEnv };
}

async function readRows(apiKey: string, baseId: string, basketId?: string): Promise<AirtableRow[]> {
  const response = await fetch(listUrl(baseId, basketId), { headers: headers(apiKey) });
  if (!response.ok) throw new Error(`Airtable BASKET CANDIDATES read failed [${response.status}]: ${await response.text()}`);
  const payload = (await response.json()) as AirtableListResponse;
  if (!Array.isArray(payload.records)) throw new Error("Airtable BASKET CANDIDATES read returned no records array; refusing to guess.");
  return payload.records.map((record) => {
    if (!nonEmpty(record.id)) throw new Error("Airtable BASKET CANDIDATES row is missing its record id; refusing partial read.");
    return { id: record.id, fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : {} };
  });
}

export function legacyDeliveryJudge(basket: CandidateBasket, storedJudgeId: string): ReturnType<typeof judgeCandidateBasket> | { error: string } {
  const demanded = new Set(basket.coverage.demandItemKeys);
  const sourced = new Set(basket.coverage.sourcedItemKeys);
  const covered = new Set([...sourced, ...basket.coverage.unsourcedItemKeys]);
  if (basket.lines.length === 0) return { error: "BASKET_HAS_NO_LINES" };
  if (!basket.complete || basket.coverage.unsourcedItemKeys.length > 0) return { error: "BASKET_COVERAGE_INCOMPLETE" };
  if (!basket.readyForReview || basket.readyForApproval !== false) return { error: "LEGACY_REVIEW_FLAGS_INVALID" };
  if (basket.dispatched !== false || basket.requiresHumanApproval !== true) return { error: "INVALID_LIFECYCLE_FLAGS" };
  if (demanded.size !== basket.coverage.demandItemKeys.length || sourced.size !== basket.coverage.sourcedItemKeys.length) return { error: "DUPLICATE_COVERAGE" };
  for (const key of covered) if (!demanded.has(key)) return { error: "COVERAGE_OUTSIDE_DEMAND" };
  for (const line of basket.lines) {
    if (!line.itemKey || !sourced.has(line.itemKey)) return { error: `LINE_NOT_IN_SOURCED_COVERAGE:${line.itemKey}` };
    const hasExplicitNonFatalPackUnitException = basket.exceptions.some((exception) => exception.itemKey === line.itemKey && exception.code === "PACK_UNIT_MISMATCH" && exception.fatal === false);
    if (!Number.isFinite(line.requiredQuantity) || line.requiredQuantity <= 0 || !Number.isFinite(line.packSize) || line.packSize <= 0 || !Number.isSafeInteger(line.packCount) || line.packCount < 1 || !Number.isFinite(line.orderedQuantity) || line.orderedQuantity < line.requiredQuantity || Math.abs(line.orderedQuantity - line.packSize * line.packCount) > 0.000001 || (line.packUnit !== line.unit && !hasExplicitNonFatalPackUnitException)) return { error: `INVALID_LINE_ARITHMETIC:${line.itemKey}` };
  }
  return {
    judgeId: storedJudgeId,
    basketId: basket.basketId,
    verdict: basket.exceptions.length > 0 ? "NEEDS_REVIEW" : "PASS",
    readyForApproval: basket.exceptions.length === 0 && basket.readyForApproval,
    tradeoffs: ["Legacy delivery handoff: basket predates line-level procurement provenance fields; exact basket fingerprint and explicit human review remain required."],
    reasons: basket.exceptions.length > 0 ? [`Basket has ${basket.exceptions.length} sourcing/procurement exception(s).`] : [],
  };
}

// Keep this intentionally one-line: the CI Prettier plugin and formatter currently disagree on this long signature.
// prettier-ignore
function validateRow(fields: Record<string, unknown>): { basket: CandidateBasket; judge: ReturnType<typeof judgeCandidateBasket>; fingerprint: string; status: "PENDING" | "APPROVED"; basketVersion: number } | { error: string } {
  const basket = parseBasket(fields["Basket payload"]);
  if (!basket) return { error: "BASKET_PAYLOAD_INVALID" };
  if (readString(fields, "Basket") !== basket.basketId) return { error: "BASKET_IDENTITY_MISMATCH" };
  if (readString(fields, "Retailer") !== (basket.retailer ?? "")) return { error: "RETAILER_PROVENANCE_MISMATCH" };
  const strictPayload = basket.lines.every((line) => Array.isArray(line.sourceEventIds) && Array.isArray(line.requirementIds) && typeof line.lineCost === "number" && Number.isFinite(line.lineCost)) && typeof basket.totalCost === "number" && Number.isFinite(basket.totalCost);
  const storedJudgeId = readString(fields, "Judge ID");
  const strictJudge = strictPayload ? judgeCandidateBasket(basket) : null;
  const judge = strictJudge ?? (storedJudgeId ? legacyDeliveryJudge(basket, storedJudgeId) : { error: "JUDGE_PROVENANCE_MISSING" });
  if ("error" in judge) return { error: judge.error };
  if (strictPayload && readNumber(fields, "Estimated total") !== basket.totalCost) return { error: "TOTAL_PROVENANCE_MISMATCH" };
  if (!basket.complete || basket.coverage.unsourcedItemKeys.length > 0) return { error: "BASKET_COVERAGE_INCOMPLETE" };
  const status = readString(fields, "Approval status");
  if (status === "APPROVED" && (!storedJudgeId || storedJudgeId !== judge.judgeId)) return { error: "JUDGE_RESULT_CHANGED" };
  const storedFingerprint = readString(fields, "Basket fingerprint");
  const fingerprint = basketApprovalFingerprint(basket);
  if (status === "APPROVED" && (!storedFingerprint || storedFingerprint !== fingerprint)) return { error: "BASKET_FINGERPRINT_CHANGED" };
  const expectedJudgeVerdict = judge.verdict === "PASS" ? new Set(["Winner", "PASS"]) : new Set(["Needs review"]);
  if (!expectedJudgeVerdict.has(readString(fields, "Judge verdict") ?? "")) return { error: "JUDGE_VERDICT_PROVENANCE_INVALID" };
  if (status !== "PENDING" && status !== "APPROVED") return { error: "APPROVAL_STATUS_INVALID" };
  const basketVersion = readNumber(fields, "Basket version");
  if (!basketVersion || !Number.isSafeInteger(basketVersion) || basketVersion < 1) return { error: "VERSION_INVALID" };
  return { basket, judge, fingerprint, status, basketVersion };
}

function buildApproval(basket: CandidateBasket, judge: ReturnType<typeof judgeCandidateBasket>, fingerprint: string, basketVersion: number, approvedAt: string, approvedBy: string): BasketApproval {
  const base: BasketApproval = { approvalId: "", basketId: basket.basketId, basketVersion, basketFingerprint: fingerprint, judgeId: judge.judgeId, policyIdentity: PRESENT_APPROVED_BASKET_POLICY, policyVersion: PRESENT_APPROVED_BASKET_POLICY_VERSION, status: "APPROVED", approvedAt, approvedBy };
  return { ...base, approvalId: approvalId(base) };
}

function validateApprovedFields(fields: Record<string, unknown>, basket: CandidateBasket, judge: ReturnType<typeof judgeCandidateBasket>, fingerprint: string, basketVersion: number): string | null {
  if (readString(fields, "Approval status") !== "APPROVED") return "NOT_APPROVED";
  const approvedAt = readString(fields, "Approved at") ?? "";
  const approvedBy = readString(fields, "Approved by") ?? "";
  if (!approvedBy || !approvedAt || Number.isNaN(Date.parse(approvedAt)) || Date.parse(approvedAt) > Date.now()) return "APPROVAL_PROVENANCE_INVALID";
  const approval = buildApproval(basket, judge, fingerprint, basketVersion, approvedAt, approvedBy);
  if (readString(fields, "Approval ID") !== approval.approvalId) return "APPROVAL_ID_INVALID";
  if (readString(fields, "Approval policy identity") !== approval.policyIdentity || readNumber(fields, "Approval policy version") !== approval.policyVersion) return "APPROVAL_POLICY_INVALID";
  if (readNumber(fields, "Basket version") !== approval.basketVersion || readString(fields, "Basket fingerprint") !== approval.basketFingerprint || readString(fields, "Judge ID") !== approval.judgeId) return "APPROVAL_BINDING_INVALID";
  return null;
}

function approvalProvenance(fields: Record<string, unknown>): { approvalId?: string; approvedAt?: string; approvedBy?: string } {
  const approvalId = readString(fields, "Approval ID");
  const approvedAt = readString(fields, "Approved at");
  const approvedBy = readString(fields, "Approved by");
  return {
    ...(approvalId === undefined ? {} : { approvalId }),
    ...(approvedAt === undefined ? {} : { approvedAt }),
    ...(approvedBy === undefined ? {} : { approvedBy }),
  };
}

export const getDeliveryBasket = createServerFn({ method: "GET" }).handler(async (): Promise<DeliveryBasketRead> => {
  const env = await runtimeEnvironment();
  const authorization = await authorizeOperatorSession(new Request("https://foodos.local/runtime/procurement/delivery-basket", { headers: { cookie: getRequestHeader("cookie") ?? "" } }), env);
  if (authorization) { setResponseStatus(authorization.status); return (await authorization.json()) as DeliveryBasketRead; }
  const apiKey = env['AIRTABLE_API_KEY'];
  const baseId = env['AIRTABLE_FOOD_OS_BASE_ID'];
  if (!apiKey || !baseId) { setResponseStatus(503); return { status: "NOT_READY", detail: "Production Airtable connector is not configured." }; }
  try {
    const rows = await readRows(apiKey, baseId);
    if (rows.length !== 1) return { status: "NOT_READY", detail: `Expected exactly one pending/approved basket; found ${rows.length}.` };
    const row = rows[0]!;
    const validation = validateRow(row.fields);
    if ("error" in validation) return { status: "NOT_READY", detail: validation.error };
    if (validation.status === "APPROVED") {
      const approvalError = validateApprovedFields(row.fields, validation.basket, validation.judge, validation.fingerprint, validation.basketVersion);
      if (approvalError) return { status: "NOT_READY", detail: approvalError };
    }
    return { status: "READY", basket: validation.basket, approval: { status: validation.status, basketVersion: validation.basketVersion, basketFingerprint: validation.fingerprint, judgeId: validation.judge.judgeId, ...approvalProvenance(row.fields) }, reviewRequired: validation.status === "PENDING" };
  } catch (error) { setResponseStatus(422); return { status: "NOT_READY", detail: error instanceof Error ? error.message : String(error) }; }
});

export const approveDeliveryBasket = createServerFn({ method: "POST" })
  .validator((data: { basketId: string; basketFingerprint: string; acknowledgeExceptions: boolean }) => data)
  .handler(async ({ data }): Promise<DeliveryBasketApprovalResult> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeOperatorSession(new Request("https://foodos.local/runtime/procurement/delivery-basket/approve", { method: "POST", headers: { cookie: getRequestHeader("cookie") ?? "" } }), env);
    if (authorization) { setResponseStatus(authorization.status); return (await authorization.json()) as DeliveryBasketApprovalResult; }
    const apiKey = env['AIRTABLE_API_KEY'];
    const baseId = env['AIRTABLE_FOOD_OS_BASE_ID'];
    if (!apiKey || !baseId) { setResponseStatus(503); return { ok: false, detail: "Production Airtable connector is not configured." }; }
    if (!data.basketId.trim() || !data.basketFingerprint.trim()) return { ok: false, detail: "BASKET_IDENTITY_REQUIRED" };
    if (!data.acknowledgeExceptions) return { ok: false, detail: "EXCEPTION_ACKNOWLEDGEMENT_REQUIRED" };
    try {
      const rows = await readRows(apiKey, baseId, data.basketId);
      if (rows.length !== 1) return { ok: false, detail: `Expected exactly one basket row for ${data.basketId}; found ${rows.length}.` };
      const row = rows[0]!;
      const validation = validateRow(row.fields);
      if ("error" in validation) return { ok: false, detail: validation.error };
      if (validation.status !== "PENDING") return { ok: false, detail: "BASKET_ALREADY_PROCESSED" };
      if (data.basketFingerprint !== validation.fingerprint) return { ok: false, detail: "BASKET_FINGERPRINT_CHANGED" };
      const now = new Date().toISOString();
      const approval = buildApproval(validation.basket, validation.judge, validation.fingerprint, validation.basketVersion, now, "James");
      const update = await fetch(recordUrl(baseId, row.id), { method: "PATCH", headers: headers(apiKey), body: JSON.stringify({ fields: { "Approval status": "APPROVED", "Approval ID": approval.approvalId, "Basket version": approval.basketVersion, "Basket fingerprint": approval.basketFingerprint, "Approved at": approval.approvedAt, "Approved by": approval.approvedBy, "Judge ID": approval.judgeId, "Approval policy identity": approval.policyIdentity, "Approval policy version": approval.policyVersion, "Judge verdict": validation.judge.verdict === "PASS" ? "Winner" : "Needs review" }, typecast: false }) });
      if (!update.ok) return { ok: false, detail: `Airtable basket approval failed [${update.status}]: ${await update.text()}` };
      const returned = (await update.json()) as AirtableRecord;
      const returnedFields = returned.fields && typeof returned.fields === "object" ? returned.fields as Record<string, unknown> : {};
      if (readString(returnedFields, "Approval status") !== "APPROVED" || readString(returnedFields, "Approval ID") !== approval.approvalId || readString(returnedFields, "Approval policy identity") !== approval.policyIdentity) return { ok: false, detail: "APPROVAL_WRITE_NOT_VERIFIED" };
      return { ok: true, approvalId: approval.approvalId, basketId: validation.basket.basketId };
    } catch (error) { setResponseStatus(422); return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
  });
