/**
 * Release gate for the append seam.
 *
 * Nothing may reach a connector without passing through here first. The gate
 * is deliberately pessimistic:
 *   - the default target is TEST/SIMULATION; production is opt-in per call
 *   - production requires an explicit human APPROVED decision bound to THIS
 *     Event ID and payload hash, with strong transaction evidence
 *   - production requires the exact canonical ACTION POLICY identity/version
 *   - production requires a real connector credential to exist
 *   - a `Record class = Test` row can never be released as production
 */

import type {
  AppendAuthorization,
  AuthorizationDecision,
  CanonicalAppendRecord,
  EvidenceSource,
  WriterMode,
} from "./types";
import { isCanonicalAppendRecord } from "./canonical";

/** The canonical Family Alpha household-event policy. */
export const FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID = "family-alpha-household-event:v1";
export const FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION = 1;

/**
 * The canonical household stock-input policy. It authorises exactly one thing:
 * an explicit human stock intake/correction stated on the FoodOS household
 * surface, recorded as a Correction row. It grants no delivery, basket,
 * procurement or baseline authority.
 */
export const HOUSEHOLD_STOCK_INPUT_POLICY_ID = "household-stock-input:v1";
export const HOUSEHOLD_STOCK_INPUT_POLICY_VERSION = 1;

/** Where the caller wants the row to land. Default is the synthetic path. */
export type ReleaseTarget = "TEST_SIMULATION" | "PRODUCTION_WRITE";

export type ReleaseRefusalCode =
  | "NOT_CANONICAL"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_NOT_GRANTED"
  | "AUTHORIZATION_SCOPE_MISMATCH"
  | "INSUFFICIENT_EVIDENCE"
  | "TEST_RECORD_REFUSED"
  | "PRODUCTION_WRITE_UNAVAILABLE"
  | "PRODUCTION_WRITE_DISABLED"
  | "POLICY_ID_REQUIRED"
  | "POLICY_VERSION_REQUIRED"
  | "POLICY_ID_MISMATCH"
  | "POLICY_VERSION_MISMATCH";

export interface ReleaseRefusal {
  code: ReleaseRefusalCode;
  detail: string;
}

export interface AuthorizeAppendRequest {
  record: CanonicalAppendRecord;
  target?: ReleaseTarget;
  decision?: AuthorizationDecision;
  approvedBy?: string;
  approvedAt?: string;
  evidenceSource?: EvidenceSource;
  evidenceDetail?: string;
  actionPolicyReference?: string;
  authorizationId?: string;
  policyIdentity?: string;
  policyVersion?: number;
  credentialAvailable?: boolean;
}

export type AuthorizeAppendResult =
  | {
      granted: true;
      authorization: AppendAuthorization;
      writerMode: WriterMode;
      target: ReleaseTarget;
    }
  | { granted: false; refusal: ReleaseRefusal; target: ReleaseTarget };

const ACCEPTED_EVIDENCE = new Set<EvidenceSource>([
  "EXPLICIT_USER_INPUT",
  "STRONG_TRANSACTION_EVIDENCE",
]);

function isRoutineStockCorrection(record: CanonicalAppendRecord): boolean {
  return record.row["Event type"] === "Correction";
}

export function authorizeAppend(request: AuthorizeAppendRequest): AuthorizeAppendResult {
  const target: ReleaseTarget = request.target ?? "TEST_SIMULATION";
  const refuse = (code: ReleaseRefusalCode, detail: string): AuthorizeAppendResult => ({
    granted: false,
    refusal: { code, detail },
    target,
  });

  if (!isCanonicalAppendRecord(request.record)) {
    return refuse("NOT_CANONICAL", "Only a canonical append record can be authorised.");
  }
  const record = request.record;

  if (!request.decision) {
    return refuse("AUTHORIZATION_REQUIRED", "ACTION POLICY: recording a household event is PREPARE, never auto-execute. An explicit human decision is required.");
  }
  if (request.decision !== "APPROVED") {
    return refuse("AUTHORIZATION_NOT_GRANTED", `Decision is ${request.decision}; no release is issued.`);
  }
  if (!request.approvedBy?.trim()) {
    return refuse("AUTHORIZATION_REQUIRED", "An approval must name the human who made it; the runtime never self-approves.");
  }
  if (!request.evidenceSource || !ACCEPTED_EVIDENCE.has(request.evidenceSource)) {
    return refuse("INSUFFICIENT_EVIDENCE", "Evidence must be explicit user input or strong transaction evidence, per the ACTION POLICY.");
  }
  if (!request.evidenceDetail?.trim()) {
    return refuse("INSUFFICIENT_EVIDENCE", "The evidence relied upon must be recorded verbatim.");
  }

  if (target === "PRODUCTION_WRITE") {
    if (request.credentialAvailable !== true) {
      return refuse("PRODUCTION_WRITE_UNAVAILABLE", "No production connector credential exists in this workspace, so PRODUCTION_WRITE is unavailable. No credential is invented.");
    }
    if (record.row["Record class"] !== "Production") {
      return refuse("TEST_RECORD_REFUSED", "`Record class = Test` can never be released as a production append.");
    }

    const stockCorrection = isRoutineStockCorrection(record);
    const expectedPolicyId = stockCorrection ? HOUSEHOLD_STOCK_INPUT_POLICY_ID : FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID;
    const expectedPolicyVersion = stockCorrection ? HOUSEHOLD_STOCK_INPUT_POLICY_VERSION : FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION;
    const expectedEvidence = stockCorrection ? "EXPLICIT_USER_INPUT" : "STRONG_TRANSACTION_EVIDENCE";

    if (request.policyIdentity?.trim() !== expectedPolicyId) {
      return refuse(request.policyIdentity?.trim() ? "POLICY_ID_MISMATCH" : "POLICY_ID_REQUIRED", `Production writes require canonical policy identity ${expectedPolicyId}.`);
    }
    if (request.policyVersion !== expectedPolicyVersion) {
      return refuse(Number.isInteger(request.policyVersion) ? "POLICY_VERSION_MISMATCH" : "POLICY_VERSION_REQUIRED", `Production writes require policy version ${expectedPolicyVersion}.`);
    }
    if (request.evidenceSource !== expectedEvidence) {
      return refuse("INSUFFICIENT_EVIDENCE", stockCorrection
        ? "Routine household stock corrections require explicit user input bound to the exact correction; transaction evidence is not required."
        : "Family Alpha Production household-event writes require strong transaction evidence; explicit user input alone is insufficient.");
    }
  }

  const authorization: AppendAuthorization = {
    authorizationId: request.authorizationId ?? `AUTH-${record.eventId}`,
    decision: "APPROVED",
    approvedBy: request.approvedBy,
    approvedAt: request.approvedAt ?? record.row["Recorded at"],
    evidenceSource: request.evidenceSource,
    evidenceDetail: request.evidenceDetail,
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: request.actionPolicyReference ?? "ACTION POLICY: record a routine consumption event (PREPARE)",
    ...(request.policyIdentity === undefined ? {} : { policyIdentity: request.policyIdentity }),
    ...(request.policyVersion === undefined ? {} : { policyVersion: request.policyVersion }),
  };

  return {
    granted: true,
    authorization,
    writerMode: target === "PRODUCTION_WRITE" ? "PRODUCTION_WRITE" : "PROPOSE",
    target,
  };
}

export function productionWriteAvailable(credential?: string | null): boolean {
  return typeof credential === "string" && credential.trim().length > 0;
}
