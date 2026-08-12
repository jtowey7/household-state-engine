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

/**
 * A canonical, append-only event record: a fully validated HOUSEHOLD EVENTS
 * row plus its immutable identity. The writer accepts nothing else — callers
 * cannot hand it a loose object, and cannot mint identity themselves.
 */
export interface CanonicalAppendRecord {
  /** Immutable Event ID, derived from the canonical payload. */
  readonly eventId: string;
  /** Hash of the canonical payload; the identity of that Event ID. */
  readonly payloadHash: string;
  /** The exact row, in the real 19-field HOUSEHOLD EVENTS contract. */
  readonly row: HouseholdEventRowDraft;
  /** Branded so an arbitrary literal cannot be passed as canonical. */
  readonly __canonical: "HOUSEHOLD_EVENTS";
}

export type EvidenceSource =
  /** A human explicitly stated the fact. */
  | "EXPLICIT_USER_INPUT"
  /** A receipt, delivery note, or equivalent transaction record. */
  | "STRONG_TRANSACTION_EVIDENCE";

export type AuthorizationDecision = "APPROVED" | "REJECTED" | "DEFERRED";

/**
 * An explicit human authorization for ONE canonical event. It is bound to the
 * event's identity, so an approval for one fact can never be replayed onto a
 * different payload.
 */
export interface AppendAuthorization {
  authorizationId: string;
  decision: AuthorizationDecision;
  /** Human who decided. The runtime never self-approves. */
  approvedBy: string;
  approvedAt: string;
  evidenceSource: EvidenceSource;
  /** Free-text evidence the human relied on. */
  evidenceDetail: string;
  /** Must equal the canonical record's Event ID. */
  eventId: string;
  /** Must equal the canonical record's payload hash. */
  payloadHash: string;
  /** The ACTION POLICY clause relied upon. */
  actionPolicyReference: string;
}

export type WriterMode =
  /** Proposal only. Nothing may reach a production connector. */
  | "PROPOSE"
  /** A real production append is permitted, subject to every other gate. */
  | "PRODUCTION_WRITE";

export type ConnectorProvenance =
  /** Synthetic test double. Must never claim production. */
  | "SYNTHETIC"
  /** A real connector talking to the real base. */
  | "PRODUCTION";

/**
 * The append-only production port. ONE verb, by construction.
 * Implementations must never mutate an existing record.
 */
export interface ProductionEventAppendPort {
  readonly portId: string;
  readonly provenance: ConnectorProvenance;
  /** The only write operation in the seam. */
  append(record: CanonicalAppendRecord): Promise<PortAppendAck>;
}

/** Acknowledgement returned by a connector after a successful append. */
export interface PortAppendAck {
  /** Connector-side record id (e.g. Airtable `rec…`). Never an Event ID. */
  connectorRecordId: string;
  /** Connector-reported creation instant. */
  acknowledgedAt: string;
  /** True when the connector recognised an identical prior append. */
  duplicate?: boolean;
}

/**
 * The contract a future real Airtable connector must satisfy. It is declared
 * here and deliberately NOT implemented: the workspace has no Airtable
 * connection, and a stand-in that pretended otherwise would be a lie in code.
 */
export interface AirtableAppendPort extends ProductionEventAppendPort {
  readonly provenance: "PRODUCTION";
  readonly baseId: string;
  readonly tableName: "HOUSEHOLD EVENTS";
}

export type WriterRejectionCode =
  /** No authorization object supplied at all. */
  | "AUTHORIZATION_REQUIRED"
  /** Supplied, but the decision was not APPROVED. */
  | "AUTHORIZATION_NOT_GRANTED"
  /** Approval is for a different Event ID or a different payload. */
  | "AUTHORIZATION_SCOPE_MISMATCH"
  /** Evidence source is not one the ACTION POLICY accepts. */
  | "INSUFFICIENT_EVIDENCE"
  /** Writer is in PROPOSE mode; production writes are structurally disabled. */
  | "PRODUCTION_WRITE_DISABLED"
  /** PRODUCTION_WRITE requested with no port supplied. */
  | "NO_CONNECTOR"
  /** A synthetic port may never satisfy a production write. */
  | "SYNTHETIC_PROVENANCE_REFUSED"
  /** Test-class rows never enter production household state. */
  | "TEST_RECORD_REFUSED"
  /** The record is not a canonical, validated event record. */
  | "NOT_CANONICAL"
  /** Same Event ID, different canonical payload. Hard conflict, no write. */
  | "REUSED_EVENT_ID_PAYLOAD_CONFLICT"
  /** The connector itself failed. */
  | "CONNECTOR_FAILED";

export interface WriterRejection {
  code: WriterRejectionCode;
  detail: string;
}

export type WriteOutcome =
  /** Prepared for a human, nothing written anywhere. */
  | "PROPOSED"
  /** Written to a synthetic port. Explicitly not production. */
  | "APPENDED_SYNTHETIC"
  /** Written to a real production connector. */
  | "APPENDED_PRODUCTION"
  /** Identical event already appended: no second write. */
  | "DUPLICATE_NOOP"
  /** Refused. */
  | "REJECTED";

/**
 * Receipt for an append attempt. Deterministic: the same record, port and
 * authorization always yield the same receipt id.
 */
export interface AppendReceipt {
  receiptId: string;
  /** Immutable Event ID of the record. */
  eventId: string;
  payloadHash: string;
  outcome: WriteOutcome;
  /** True only when a row actually entered a port. */
  written: boolean;
  /** Connector provenance, recorded honestly. */
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
  /** Always false: this seam has no inventory verb. */
  readonly inventoryMutated: false;
  rejection: WriterRejection | null;
}
