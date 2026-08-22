/**
 * Family Alpha controlled Production write boundary.
 * Pure authorization/plan gate: this module performs no network or database I/O.
 */

export const FAMILY_ALPHA_OPERATION = "HOUSEHOLD_EVENT_APPEND" as const;
export type FamilyAlphaOperation = typeof FAMILY_ALPHA_OPERATION;

export type ControlledWriteEvent = {
  eventId: string;
  recordClass: "Production";
  eventType: "ITEM_STOCK_DELTA";
  itemKey: string;
  occurredAt: string;
  payload: { quantity: number; unit: string; note?: string };
  supersedes?: string[];
};

export type HumanApproval = {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  operation: FamilyAlphaOperation;
  expectedSnapshotId: string;
  expectedReplayId: string;
  releaseId: string;
  requestFingerprint: string;
};

export type CompensatingEvent = {
  eventId: string;
  recordClass: "Production";
  eventType: "ITEM_STOCK_DELTA";
  itemKey: string;
  occurredAt: string;
  payload: { quantity: number; unit: string; note?: string };
  supersedes?: string[];
  compensatesEventId: string;
};

export type ControlledWriteRequest = {
  operation: FamilyAlphaOperation;
  releaseId: string;
  expectedSnapshotId: string;
  expectedReplayId: string;
  event: ControlledWriteEvent;
  compensation: CompensatingEvent;
  approval: HumanApproval;
};

type FingerprintInput = Omit<ControlledWriteRequest, "approval">;

export type ControlledWriteRejectionCode =
  | "OPERATION_NOT_ALLOWED" | "MISSING_RELEASE_ID" | "MISSING_SNAPSHOT_BINDING"
  | "MISSING_REPLAY_BINDING" | "MISSING_APPROVAL" | "AUTOMATED_APPROVAL_REJECTED"
  | "APPROVAL_OPERATION_MISMATCH" | "APPROVAL_SNAPSHOT_MISMATCH" | "APPROVAL_REPLAY_MISMATCH"
  | "APPROVAL_RELEASE_MISMATCH" | "APPROVAL_FINGERPRINT_MISMATCH" | "APPROVAL_EXPIRED"
  | "INVALID_EVENT_ID" | "INVALID_EVENT_CLASS" | "INVALID_EVENT_ITEM" | "INVALID_EVENT_TIME"
  | "INVALID_COMPENSATION" | "PAYLOAD_CONFLICT";

export type ControlledWriteDecision =
  | { ok: true; request: ControlledWriteRequest; mutationCount: 0 | 1; externalIOMode: "NONE" }
  | { ok: false; code: ControlledWriteRejectionCode; detail: string };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function time(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function automatedPrincipal(value: string): boolean {
  return /(?:scheduler|agent|bot|workflow|automation|system)/i.test(value.trim());
}

export function familyAlphaRequestFingerprint(request: FingerprintInput): string {
  return stableJson({
    operation: request.operation,
    releaseId: request.releaseId,
    expectedSnapshotId: request.expectedSnapshotId,
    expectedReplayId: request.expectedReplayId,
    event: request.event,
    compensation: request.compensation,
  });
}

export function authorizeFamilyAlphaWrite(
  request: ControlledWriteRequest,
  now: string,
): ControlledWriteDecision {
  if (request.operation !== FAMILY_ALPHA_OPERATION)
    return { ok: false, code: "OPERATION_NOT_ALLOWED", detail: "Only HOUSEHOLD_EVENT_APPEND is permitted." };
  if (!nonEmpty(request.releaseId))
    return { ok: false, code: "MISSING_RELEASE_ID", detail: "A unique releaseId is required." };
  if (!nonEmpty(request.expectedSnapshotId))
    return { ok: false, code: "MISSING_SNAPSHOT_BINDING", detail: "The write must bind to snapshotId." };
  if (!nonEmpty(request.expectedReplayId))
    return { ok: false, code: "MISSING_REPLAY_BINDING", detail: "The write must bind to replayId." };

  const approval = request.approval;
  if (!approval || !nonEmpty(approval.approvalId) || !nonEmpty(approval.approvedBy))
    return { ok: false, code: "MISSING_APPROVAL", detail: "A human approval is mandatory." };
  if (automatedPrincipal(approval.approvedBy))
    return { ok: false, code: "AUTOMATED_APPROVAL_REJECTED", detail: "Automated principals cannot approve Production writes." };
  if (approval.operation !== request.operation)
    return { ok: false, code: "APPROVAL_OPERATION_MISMATCH", detail: "Approval operation does not match." };
  if (approval.expectedSnapshotId !== request.expectedSnapshotId)
    return { ok: false, code: "APPROVAL_SNAPSHOT_MISMATCH", detail: "Approval is bound to a different snapshot." };
  if (approval.expectedReplayId !== request.expectedReplayId)
    return { ok: false, code: "APPROVAL_REPLAY_MISMATCH", detail: "Approval is bound to a different replay." };
  if (approval.releaseId !== request.releaseId)
    return { ok: false, code: "APPROVAL_RELEASE_MISMATCH", detail: "Approval is bound to a different release." };
  if (!nonEmpty(approval.requestFingerprint) || approval.requestFingerprint !== familyAlphaRequestFingerprint(request))
    return { ok: false, code: "APPROVAL_FINGERPRINT_MISMATCH", detail: "Approval is not bound to the exact write payload." };

  const nowMs = time(now);
  const approvedAt = time(approval.approvedAt);
  const expiresAt = time(approval.expiresAt);
  if (nowMs === null || approvedAt === null || expiresAt === null || expiresAt <= approvedAt || nowMs < approvedAt || nowMs >= expiresAt)
    return { ok: false, code: "APPROVAL_EXPIRED", detail: "Approval is outside its valid time window." };

  const event = request.event;
  if (!nonEmpty(event.eventId) || /^rec[a-z0-9]+$/i.test(event.eventId))
    return { ok: false, code: "INVALID_EVENT_ID", detail: "Production Event ID must not be an Airtable record id." };
  if (event.recordClass !== "Production")
    return { ok: false, code: "INVALID_EVENT_CLASS", detail: "Family Alpha writes are Production-class only." };
  if (!nonEmpty(event.itemKey))
    return { ok: false, code: "INVALID_EVENT_ITEM", detail: "A household item key is required." };
  if (time(event.occurredAt) === null)
    return { ok: false, code: "INVALID_EVENT_TIME", detail: "Event occurrence time must be valid." };
  if (!Number.isFinite(event.payload.quantity) || !nonEmpty(event.payload.unit))
    return { ok: false, code: "INVALID_EVENT_ITEM", detail: "Family Alpha stock deltas require a finite quantity and unit." };

  const compensation = request.compensation;
  if (!compensation || compensation.recordClass !== "Production" || !nonEmpty(compensation.eventId)
      || /^rec[a-z0-9]+$/i.test(compensation.eventId) || compensation.eventId === event.eventId
      || compensation.compensatesEventId !== event.eventId || compensation.itemKey !== event.itemKey
      || compensation.eventType !== event.eventType || compensation.payload.unit !== event.payload.unit
      || !Number.isFinite(compensation.payload.quantity) || compensation.payload.quantity !== -event.payload.quantity
      || time(compensation.occurredAt) === null) {
    return { ok: false, code: "INVALID_COMPENSATION", detail: "Compensation must be a distinct Production stock delta on the same item/unit with the exact inverse quantity." };
  }

  return { ok: true, request, mutationCount: 1, externalIOMode: "NONE" };
}

export function validateFamilyAlphaReplay(
  first: ControlledWriteRequest,
  replay: ControlledWriteRequest,
): ControlledWriteDecision {
  if (first.releaseId !== replay.releaseId)
    return authorizeFamilyAlphaWrite(replay, replay.approval.approvedAt);
  if (!sameJson(first, replay))
    return { ok: false, code: "PAYLOAD_CONFLICT", detail: "The same releaseId was replayed with a different payload; refuse." };
  return { ok: true, request: replay, mutationCount: 0, externalIOMode: "NONE" };
}
