/**
 * Food OS — EXPECTED vs CONFIRMED household state (isolated seam).
 *
 * Scope boundary: this module keeps *planned/expected* consumption strictly
 * separate from *confirmed* household-state mutations, and reconciles the two
 * only through explicit, provenance-carrying evidence. It performs no I/O and
 * is not connected to Airtable or to real household data. Core State Engine
 * replay semantics, Event ID identity and approval boundaries are unchanged.
 */

import type {
  HouseholdEvent,
  QuantityRequirementsHandoff,
  RecordClass,
  ReconciliationStatus,
  StateSnapshot,
} from "../state-engine/types";

/** A planned burn. Planning intent ONLY — never observed truth. */
export interface ExpectedConsumption {
  /** Stable identity of the expectation across cycle runs. */
  expectationId: string;
  itemKey: string;
  quantity: number;
  unit: string;
  /** ISO-8601 instant the consumption is expected to happen. */
  expectedAt: string;
  /** Meal / allocation / plan id this expectation came from. */
  sourceId: string;
  recordClass?: RecordClass;
}

/**
 * A household interaction that produced evidence. Interaction never mutates
 * truth directly: it is reconciled against an expectation and recorded as a
 * confirmed event only when the evidence is sufficient.
 */
export interface ConsumptionEvidence {
  /** Immutable evidence id — applied at most once. */
  evidenceId: string;
  /** Expectation this evidence confirms, if any. */
  expectationId?: string | null;
  itemKey: string;
  /** Quantity actually observed as consumed. */
  observedQuantity?: number | null;
  unit?: string | null;
  observedAt: string;
  actor?: string;
  source?: string;
  /** OBSERVED / REPORTED are sufficient; UNKNOWN (or missing) is not. */
  confidence?: "OBSERVED" | "REPORTED" | "UNKNOWN";
  note?: string;
  recordClass?: RecordClass;
}

export type ReconciliationEntryStatus =
  /** Evidence agrees with the expectation within tolerance. */
  | "MATCHED"
  /** Evidence disagrees with the expectation; never silently resolved. */
  | "DIVERGED"
  /** Expectation is due but no evidence has arrived yet. */
  | "AWAITING_EVIDENCE"
  /** Expectation is not due yet. */
  | "NOT_DUE"
  /** Evidence exists but is too weak to confirm state. */
  | "EVIDENCE_INSUFFICIENT"
  /** Evidence unit is incomparable with the expectation unit. */
  | "UNIT_CONFLICT"
  /** Evidence id reused with a different canonical payload. */
  | "EVIDENCE_PAYLOAD_CONFLICT"
  /** Evidence with no matching expectation — confirmed, not planned. */
  | "UNEXPECTED_CONFIRMED";

export interface ReconciliationEntry {
  status: ReconciliationEntryStatus;
  itemKey: string;
  expectationId: string | null;
  evidenceIds: string[];
  expectedQuantity: number | null;
  confirmedQuantity: number | null;
  unit: string | null;
  /** confirmed − expected, when both are known. */
  delta: number | null;
  /** True when this entry withholds the item from downstream quantity runs. */
  blocking: boolean;
  detail: string;
}

export type ForecastItemStatus =
  | "AGREED"
  | "AWAITING_CONFIRMATION"
  | "DIVERGED"
  | "BLOCKED";

/** Burn-down never collapses the two views into one number. */
export interface ForecastItem {
  itemKey: string;
  expectedRemaining: number;
  confirmedRemaining: number;
  /** expectedRemaining − confirmedRemaining. */
  divergence: number;
  unit: string | null;
  status: ForecastItemStatus;
}

export interface ReconciliationRun {
  /** Events derived from planning only. Never treated as observed truth. */
  expectedEvents: HouseholdEvent[];
  /** Events derived from sufficient evidence only. */
  confirmedEvents: HouseholdEvent[];
  /** Replay of opening + expected burn-down. */
  expectedSnapshot: StateSnapshot;
  /** Replay of opening + confirmed burn-down. */
  confirmedSnapshot: StateSnapshot;
  entries: ReconciliationEntry[];
  forecast: ForecastItem[];
  /** Items withheld from downstream quantity/procurement. */
  blockedItemKeys: string[];
  reconciliationStatus: ReconciliationStatus;
  /**
   * CONFIRMED-state handoff for QUANTITY REQUIREMENTS, with reconciliation
   * blocks applied. Expected state is deliberately never handed off.
   */
  handoff: QuantityRequirementsHandoff;
}

export interface ReconcileOptions {
  /** Evaluation instant; expectations at or before this are due. */
  asOf: string;
  /** Injectable clock so replays stay deterministic. */
  now?: () => string;
  /** Absolute quantity tolerance below which evidence counts as matching. */
  tolerance?: number;
}

export interface ReconcileInput {
  /** Opening balances, as ordinary household events. */
  openingEvents?: readonly HouseholdEvent[];
  expectations?: readonly ExpectedConsumption[];
  evidence?: readonly ConsumptionEvidence[];
}
