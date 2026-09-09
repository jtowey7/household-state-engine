/**
 * Food OS — authorised append-only HOUSEHOLD EVENTS WRITE seam (types).
 *
 * Policy this module encodes, verbatim from the ACTION POLICY:
 *   - `Record a routine consumption event` = PREPARE, not EXECUTE.
 *   - Evidence required = explicit user input OR strong transaction evidence.
 *   - `Never auto-execute` governs anything higher risk.
 *
 * Consequences, enforced structurally rather than by convention:
 *   - the port surface has exactly ONE verb, `append`. There is no
 *     update, delete, replace, upsert, or patch member anywhere in the seam,
 *     so "mutate an existing record" is not expressible.
 *   - a write is impossible without an explicit `AppendAuthorization` object
 *     that names the approver, the evidence source, and the exact canonical
 *     event it approves. No default, env var, or config flag substitutes.
 *   - only HOUSEHOLD EVENTS rows are ever emitted. INVENTORY is never touched:
 *     consumption and correction exist solely as new event records.
 *
 * There is NO Airtable connection in this workspace, so no real connector is
 * implemented here — only the contract a future one must satisfy.
 */

import type { HouseholdEventRowDraft } from "../write-boundary/types";

export interface CanonicalAppendRecord {
  readonly eventId: string;
  readonly payloadHash: string;
  readonly row: HouseholdEventRowDraft;
  readonly __canonical: "HOUSEHOLD_EVENTS";
}

export type EvidenceSource = "EXPLICIT_USER_INPUT" | "STRONG_TRANSACTION_EVIDENCE";

export type AuthorizationDecision = "APPROVED" | "REJECTED" | "DEFERRED";

export type AuthorizationScope = "FAMILY_ALPHA_HOUSEHOLD_EVENT" | "INITIAL_PRODUCTION_INVENTORY_BASELINE";

export interface AppendAuthorization {
  authorizationId: string;
  decision: AuthorizationDecision;
  approvedBy: string;
  approvedAt: string;
  evidenceSource: EvidenceSource;
  evidenceDetail: string;
  eventId: string;
  payloadHash: string;
  actionPolicyReference: string;
  /** Exact canonical ACTION POLICY identity observed at approval time. */
  policyIdentity?: string;
  /** Exact canonical ACTION POLICY version observed at approval time. */
  policyVersion?: number;
  /** Explicit scope for the separately governed one-time baseline authority. */
  authorizationScope?: AuthorizationScope;
}

/** One-time authority for a complete immutable INVENTORY baseline batch. */
export interface BatchAppendAuthorization {
  authorizationId: string;
  decision: AuthorizationDecision;
  approvedBy: string;
  approvedAt: string;
  evidenceSource: EvidenceSource;
  evidenceDetail: string;
  actionPolicyReference: string;
  /** Fingerprint of the complete canonical batch. */
  batchFingerprint: string;
  /** Immutable baseline snapshot identifier supplied by the audit. */
  snapshotId: string;
  /** Exact number of events approved. */
  eventCount: number;
}

export type WriterMode = "PROPOSE" | "PRODUCTION_WRITE";

export type ConnectorProvenance = "SYNTHETIC" | "PRODUCTION";

/** Connector acknowledgement of a single append. */
export interface PortAppendAck {
  connectorRecordId: string;
  acknowledgedAt: string;
  /** True when the connector matched an existing identical Event ID. */
  duplicate?: boolean;
}

/** The append-only production port: one verb, no mutation operations. */
export interface ProductionEventAppendPort {
  readonly portId: string;
  readonly provenance: ConnectorProvenance;
  append(record: CanonicalAppendRecord): Promise<PortAppendAck>;
}

export interface AirtableAppendPort extends ProductionEventAppendPort {
  readonly provenance: "PRODUCTION";
  readonly baseId: string;
  readonly tableName: "HOUSEHOLD EVENTS";
}

export type WriterRejectionCode =
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_NOT_GRANTED"
  | "AUTHORIZATION_SCOPE_MISMATCH"
  | "INSUFFICIENT_EVIDENCE"
  | "PRODUCTION_WRITE_DISABLED"
  | "NO_CONNECTOR"
  | "SYNTHETIC_PROVENANCE_REFUSED"
  | "TEST_RECORD_REFUSED"
  | "NOT_CANONICAL"
  | "REUSED_EVENT_ID_PAYLOAD_CONFLICT"
  | "CONNECTOR_FAILED"
  | "BATCH_AUTHORIZATION_SCOPE_MISMATCH"
  | "BATCH_AUTHORIZATION_INVALID";

export interface WriterRejection {
  code: WriterRejectionCode;
  detail: string;
}

export type WriteOutcome =
  | "PROPOSED"
  | "APPENDED_SYNTHETIC"
  | "APPENDED_PRODUCTION"
  | "DUPLICATE_NOOP"
  | "REJECTED";

export interface AppendReceipt {
  receiptId: string;
  eventId: string;
  payloadHash: string;
  outcome: WriteOutcome;
  written: boolean;
  connector: {
    portId: string | null;
    provenance: ConnectorProvenance | null;
    connectorRecordId: string | null;
  } | null;
  authorization: {
    authorizationId: string;
    approvedBy: string;
    evidenceSource: EvidenceSource;
    actionPolicyReference: string;
  } | null;
  table: "HOUSEHOLD EVENTS";
  readonly inventoryMutated: false;
  rejection: WriterRejection | null;
}
