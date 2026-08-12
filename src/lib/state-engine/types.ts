/**
 * Food OS — executable State Engine (isolated runtime).
 *
 * Scope boundary: this module models ONLY the HOUSEHOLD EVENTS -> household
 * state materialisation contract. It does not connect to real household data,
 * Airtable, or any wider Food OS behaviour.
 */

export type RecordClass = "Production" | "Test";

export type EventType = "ITEM_STOCK_SET" | "ITEM_STOCK_DELTA" | "ITEM_REMOVED";

export interface HouseholdEvent {
  /** Immutable Event ID. Applied at most once. */
  eventId: string;
  /** Record class = Test has zero effect on materialised state. */
  recordClass: RecordClass;
  eventType: EventType;
  /** Household item key this event mutates. */
  itemKey: string;
  /** ISO-8601 occurrence timestamp (ordering is taken from stream order). */
  occurredAt: string;
  /** Canonical payload; identity of an Event ID includes this payload. */
  payload: {
    quantity?: number;
    unit?: string;
    note?: string;
  };
  /** Event IDs superseded by this event; superseded events are not applied. */
  supersedes?: string[];
}

export type ExceptionCode =
  | "REUSED_EVENT_ID_PAYLOAD_CONFLICT"
  | "SUPERSEDED_EVENT_NOT_APPLIED"
  | "DUPLICATE_EVENT_IGNORED"
  | "TEST_RECORD_EXCLUDED";

export interface ReconciliationException {
  code: ExceptionCode;
  eventId: string;
  itemKey: string;
  detail: string;
  /** Only unresolved conflicts block downstream quantity/procurement. */
  blocking: boolean;
}

export interface ItemState {
  itemKey: string;
  quantity: number;
  unit: string | null;
  removed: boolean;
  lastAppliedEventId: string | null;
  /** Provenance: every event ID that mutated this item, in application order. */
  contributingEventIds: string[];
  /** True when an unresolved conflict touches this item. */
  blocked: boolean;
}

export type ReconciliationStatus = "CLEAN" | "EXCEPTIONS" | "BLOCKED";

export interface StateSnapshot {
  /** Deterministic hash of the applied state + provenance. */
  snapshotId: string;
  /** Deterministic hash of the canonical input event stream. */
  replayId: string;
  /** Wall-clock replay time; injectable so replays stay deterministic. */
  replayTimestamp: string;
  items: ItemState[];
  /** All event IDs that produced a mutation, in application order. */
  contributingEventIds: string[];
  /** Event IDs seen but deliberately not applied. */
  ignoredEventIds: string[];
  exceptions: ReconciliationException[];
  reconciliationStatus: ReconciliationStatus;
  /** Item keys blocked from downstream quantity/procurement. */
  blockedItemKeys: string[];
}

/** Handoff payload consumed by QUANTITY REQUIREMENTS. */
export interface QuantityRequirementsHandoff {
  replayId: string;
  snapshotId: string;
  replayTimestamp: string;
  reconciliationStatus: ReconciliationStatus;
  readyForQuantityRun: boolean;
  items: Array<{
    itemKey: string;
    quantity: number;
    unit: string | null;
    sourceEventIds: string[];
  }>;
  blockedItemKeys: string[];
}
