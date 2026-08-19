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
  /**
   * Optional stable identity context for domains where `Occurred at` is an
   * observation timestamp rather than part of the fact identity. This is
   * intentionally explicit and scoped by the caller; ordinary household
   * events retain their existing identity semantics.
   */
  identityContext?: string;
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

export interface AppendPreview {
  eventId: string;
  payloadHash: string;
  row: HouseholdEventRowDraft;
  request: {
    method: "POST";
    tableLabel: string;
    body: { records: [{ fields: HouseholdEventRowDraft }] };
  };
}

export type AppendOutcome =
  | "SIMULATED"
  | "APPENDED"
  | "DUPLICATE_NOOP"
  | "CONFLICT"
  | "REJECTED";

export interface AppendResult {
  outcome: AppendOutcome;
  preview: AppendPreview | null;
  rejection: WriteRejection | null;
  capability: WriteCapabilityMode;
  mutated: boolean;
}

export type WriteCapabilityMode = "SIMULATION" | "PRODUCTION_APPEND";

export interface ProductionWriteCapability {
  mode: "PRODUCTION_APPEND";
  sink: AppendOnlySink;
  approvalReference: string;
}

export interface AppendOnlySink {
  readonly sinkId: string;
  append(row: HouseholdEventRowDraft): Promise<void>;
}
