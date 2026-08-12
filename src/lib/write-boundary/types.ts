/**
 * Food OS — append-only production WRITE boundary (types).
 *
 * Status: there is NO Airtable connection and NO credential in this project,
 * so nothing here can reach the real base. This module defines the shape a
 * real append-only writer must satisfy, and a simulation sink that proves the
 * contract executably.
 *
 * Hard boundaries encoded in these types:
 * - the sink can ONLY append. There is no update, delete, or upsert member.
 * - the default capability is TEST/simulation. Production append requires an
 *   explicitly supplied approved runtime; absent it the boundary refuses
 *   rather than silently falling back to a simulated write.
 * - a row is only ever a HOUSEHOLD EVENTS row in the real field contract.
 */

import type { RecordClass } from "../state-engine/types";

/** The real HOUSEHOLD EVENTS "Event type" choices. */
export type AirtableEventType =
  | "Delivery"
  | "Receipt"
  | "Consumption"
  | "Correction"
  | "Confirmation"
  | "Disposal"
  | "Transfer"
  | "Substitution"
  | "Unavailable"
  | "Other";

/**
 * An emitted row in the EXACT real HOUSEHOLD EVENTS field contract. Field
 * names are verbatim and no other field may be emitted.
 */
export interface HouseholdEventRowDraft {
  "Event ID": string;
  "Event type": AirtableEventType;
  "Occurred at": string;
  "Recorded at": string;
  Source: string;
  Actor: string;
  "Entity type": string;
  "Entity reference": string;
  Item: string;
  "Quantity delta": number | null;
  Unit: string | null;
  Evidence: string;
  "State before": string;
  "State after": string;
  Confidence: string;
  "Supersedes event ID": string[];
  "Exception / reconciliation action": string;
  "Replay status": string;
  "Record class": RecordClass;
}

export const HOUSEHOLD_EVENT_WRITE_FIELDS = [
  "Event ID",
  "Event type",
  "Occurred at",
  "Recorded at",
  "Source",
  "Actor",
  "Entity type",
  "Entity reference",
  "Item",
  "Quantity delta",
  "Unit",
  "Evidence",
  "State before",
  "State after",
  "Confidence",
  "Supersedes event ID",
  "Exception / reconciliation action",
  "Replay status",
  "Record class",
] as const;

/** Caller-declared intent. The boundary derives identity; callers never do. */
export interface AppendIntent {
  eventType: AirtableEventType;
  item: string;
  occurredAt: string;
  /** Signed delta for Delivery/Receipt/Consumption/Disposal. */
  quantityDelta?: number;
  /** Absolute state for a Correction. */
  stateAfter?: number;
  stateBefore?: number;
  unit?: string;
  source: string;
  actor: string;
  entityType?: string;
  entityReference?: string;
  evidence: string;
  confidence?: string;
  supersedes?: string[];
  exceptionAction?: string;
  recordClass: RecordClass;
  /**
   * Optional caller-declared Event ID. Only honoured when it matches the
   * deterministic identity the boundary derives; a mismatch is a rejection,
   * so an Event ID can never be hand-forged onto a different payload.
   */
  eventId?: string;
}

export type WriteRejectionCode =
  | "UNSUPPORTED_EVENT_TYPE"
  | "MISSING_ITEM"
  | "MISSING_OCCURRED_AT"
  | "MISSING_QUANTITY_DELTA"
  | "MISSING_UNIT"
  | "QUANTITY_DIRECTION_CONFLICT"
  | "UNMAPPABLE_CORRECTION"
  | "MISSING_EVIDENCE"
  | "MISSING_ACTOR_OR_SOURCE"
  | "INVALID_RECORD_CLASS"
  | "EVENT_ID_MISMATCH"
  | "PRODUCTION_WRITE_UNAVAILABLE"
  | "RECORD_CLASS_CAPABILITY_MISMATCH"
  | "REUSED_EVENT_ID_PAYLOAD_CONFLICT";

export interface WriteRejection {
  code: WriteRejectionCode;
  detail: string;
}

/** Deterministic preview of the row that WOULD be appended. */
export interface AppendPreview {
  eventId: string;
  /** Canonical payload hash — identity of this Event ID. */
  payloadHash: string;
  row: HouseholdEventRowDraft;
  /** Exactly what a connector would send, for human review before approval. */
  request: {
    method: "POST";
    tableLabel: string;
    body: { records: [{ fields: HouseholdEventRowDraft }] };
  };
}

export type AppendOutcome =
  /** Simulation capability: nothing left the process. */
  | "SIMULATED"
  /** Appended to the configured sink. */
  | "APPENDED"
  /** Same Event ID, byte-identical canonical payload: no second write. */
  | "DUPLICATE_NOOP"
  /** Same Event ID, different canonical payload: refused, no mutation. */
  | "CONFLICT"
  /** Structurally invalid or not permitted. */
  | "REJECTED";

export interface AppendResult {
  outcome: AppendOutcome;
  preview: AppendPreview | null;
  rejection: WriteRejection | null;
  /** Which capability evaluated this call. */
  capability: WriteCapabilityMode;
  /** True only when a row actually entered a sink. */
  mutated: boolean;
}

export type WriteCapabilityMode = "SIMULATION" | "PRODUCTION_APPEND";

/**
 * A production append capability. It cannot be constructed from configuration
 * alone: it requires an approved runtime object AND an approval reference, so
 * human approval is never bypassed by a default.
 */
export interface ProductionWriteCapability {
  mode: "PRODUCTION_APPEND";
  /** The append-only sink supplied by an approved runtime. */
  sink: AppendOnlySink;
  /** Human approval reference recorded on every emitted row's provenance. */
  approvalReference: string;
}

/** The only write verb that exists anywhere in this codebase. */
export interface AppendOnlySink {
  readonly sinkId: string;
  /** Appends one row. Must never update or delete. */
  append(row: HouseholdEventRowDraft): Promise<void>;
}
