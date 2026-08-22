/**
 * Food OS — Family Alpha controlled Production write boundary.
 *
 * This module is deliberately an authorization/plan gate, not an Airtable
 * writer. It defines the smallest write envelope that a later connector may
 * execute: one household event, bound to the exact read-only snapshot and an
 * explicit human approval. Nothing here performs I/O.
 *
 * Safety invariants:
 * - exactly one mutation per approved release;
 * - only HOUSEHOLD_EVENT_APPEND is permitted;
 * - no retailer I/O, spend, batch mutation, or scheduler-triggered approval;
 * - approval is bound to the exact Production snapshot fingerprint;
 * - approval has an expiry and unique approval/release IDs;
 * - approval identity cannot be an obvious automation principal;
 * - the event must be Production-class and have an immutable Event ID;
 * - a compensating event is mandatory for reversibility and must reference the
 *   forward event; the compensating event is never executed automatically;
 * - replaying the same release is idempotent, while a changed payload is refused.
 */

export const FAMILY_ALPHA_OPERATION = "HOUSEHOLD_EVENT_APPEND" as const;
export type FamilyAlphaOperation = typeof FAMILY_ALPHA_OPERATION;

export type ControlledWriteEvent = {
  eventId: string;
  recordClass: "Production";
  eventType: "ITEM_STOCK_SET" | "ITEM_STOCK_DELTA" | "ITEM_REMOVED";
  itemKey: string;
  occurredAt: string;
  payload: {
    quantity?: number;
    unit?: string;
    note?: string;
  };
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
};

export type CompensatingEvent = {
  eventId: string;
  recordClass: "Production";
  eventType: ControlledWriteEvent["eventType"];
  itemKey: string;
  occurredAt: string;
  payload: ControlledWriteEvent["payload"];
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

export type ControlledWriteDecision =
  | { ok: true; request: ControlledWriteRequest; mutationCount: 1; externalIOMode: "NONE" }
  | { ok: false; code: ControlledWriteRejectionCode; detail: string };

export type ControlledWriteRejectionCode =
  | "OPERATION_NOT_ALLOWED"
  | "MISSING_RELEASE_ID"
  | "MISSING_SNAPSHOT_BINDING"
  | "MISSING_REPLAY_BINDING"
  | "MISSING_APPROVAL"
  | "AUTOMATED_APPROVAL_REJECTED"
  | "APPROVAL_OPERATION_MISMATCH"
  | "APPROVAL_SNAPSHOT_MISMATCH"
  | "APPROVAL_REPLAY_MISMATCH"
  | "APPROVAL_RELEASE_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "INVALID_EVENT_ID"
  | "INVALID_EVENT_CLASS"
  | "INVALID_EVENT_ITEM"
  | "INVALID_EVENT_TIME"
  | "INVALID_COMPENSATION"
  | "PAYLOAD_CONFLICT";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",`)}}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function looksAutomatedPrincipal(value: string): boolean {
  return /(?:scheduler|agent|bot|workflow|automation|system)/i.test(value.trim());
}

/** Validate a single Family Alpha Production write request. No external I/O occurs. */
export function authorizeFamilyAlphaWrite(
  request: ControlledWriteRequest,
  now: string,
): ControlledWriteDecision {
  if (request.operation !== FAMILY_ALPHA_OPERATION) {
    return { ok: false, code: "OPERATION_NOT_ALLOWED", detail: "Only HOUSEHOLD_EVENT_APPEND is permitted in Family Alpha." };
  }
  if (!nonEmpty(request.releaseId)) {
    return { ok: false, code: "MISSING_RELEASE_ID", detail: "A unique releaseId is required." };
  }
  if (!nonEmpty(request.expectedSnapshotId)) {
    return { ok: false, code: "MISSING_SNAPSHOT_BINDING", detail: "The write must bind to the exact read-only snapshotId." };
  }
  if (!nonEmpty(request.expectedReplayId)) {
    return { ok: false, code: "MISSING_REPLAY_BINDING", detail: "The write must bind to the exact read-only replayId." };
  }

  const approval = request.approval;
  if (!approval) {
    return { ok: false, code: "MISSING_APPROVAL", detail: "A human approval is mandatory." };
  }
  if (!nonEmpty(approval.approvalId) || !nonEmpty(approval.approvedBy)) {
    return { ok: false, code: "MISSING_APPROVAL", detail: "Approval identity is incomplete." };
  }
  if (looksAutomatedPrincipal(approval.approvedBy)) {
    return { ok: false, code: "AUTOMATED_APPROVAL_REJECTED", detail: "Scheduler/agent/system principals cannot grant Family Alpha Production approval." };
  }
  if (approval.operation !== request.operation) {
    return { ok: false, code: "APPROVAL_OPERATION_MISMATCH", detail: "Approval operation does not match the requested operation." };
  }
  if (approval.expectedSnapshotId !== request.expectedSnapshotId) {
    return { ok: false, code: "APPROVAL_SNAPSHOT_MISMATCH", detail: "Approval is not bound to the requested snapshot." };
  }
  if (approval.expectedReplayId !== request.expectedReplayId) {
    return { ok: false, code: "APPROVAL_REPLAY_MISMATCH", detail: "Approval is not bound to the requested replay." };
  }
  if (approval.releaseId !== request.releaseId) {
    return { ok: false, code: "APPROVAL_RELEASE_MISMATCH", detail: "Approval is not bound to the requested release." };
  }

  const nowMs = parseTime(now);
  const approvedAtMs = parseTime(approval.approvedAt);
  const expiresAtMs = parseTime(approval.expiresAt);
  if (nowMs === null || approvedAtMs === null || expiresAtMs === null || expiresAtMs <= approvedAtMs || nowMs < approvedAtMs || nowMs >= expiresAtMs) {
    return { ok: false, code: "APPROVAL_EXPIRED", detail: "Approval is outside its valid time window." };
  }

  const event = request.event;
  if (!nonEmpty(event.eventId) || event.eventId.startsWith("rec")) {
    return { ok: false, code: "INVALID_EVENT_ID", detail: "Production Event ID must be explicit and must not be an Airtable record id." };
  }
  if (event.recordClass !== "Production") {
    return { ok: false, code: "INVALID_EVENT_CLASS", detail: "Family Alpha writes are Production-class only." };
  }
  if (!nonEmpty(event.itemKey)) {
    return { ok: false, code: "INVALID_EVENT_ITEM", detail: "A household item key is required." };
  }
  if (parseTime(event.occurredAt) === null) {
    return { ok: false, code: "INVALID_EVENT_TIME", detail: "Event occurrence time must be a valid ISO timestamp." };
  }

  const compensation = request.compensation;
  if (!compensation || compensation.recordClass !== "Production" || !nonEmpty(compensation.eventId) || compensation.eventId.startsWith("rec") || compensation.eventId === event.eventId || compensation.compensatesEventId !== event.eventId || compensation.itemKey !== event.itemKey) {
    return { ok: false, code: "INVALID_COMPENSATION", detail: "A distinct Production compensating event bound to the forward Event ID is mandatory." };
  }
  if (parseTime(compensation.occurredAt) === null) {
    return { ok: false, code: "INVALID_COMPENSATION", detail: "Compensating event occurrence time must be valid." };
  }

  return { ok: true, request, mutationCount: 1, externalIOMode: "NONE" };
}

/**
 * Replaying a release is safe only when the complete request is identical.
 * A changed payload under an existing releaseId is a hard conflict.
 */
export function validateFamilyAlphaReplay(
  first: ControlledWriteRequest,
  replay: ControlledWriteRequest,
): ControlledWriteDecision {
  if (first.releaseId !== replay.releaseId) {
    return authorizeFamilyAlphaWrite(replay, replay.approval.approvedAt);
  }
  if (!sameJson(first, replay)) {
    return { ok: false, code: "PAYLOAD_CONFLICT", detail: "Existing releaseId was replayed with a different payload or approval; refuse rather than mutate twice." };
  }
  return { ok: true, request: replay, mutationCount: 1, externalIOMode: "NONE" };
}
