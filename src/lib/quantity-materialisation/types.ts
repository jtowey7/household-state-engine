/**
 * Food OS — current-week QUANTITY REQUIREMENTS materialisation (proposal only).
 *
 * Scope boundary: this module is PURE. It performs no Airtable I/O, proposes
 * no HOUSEHOLD EVENTS or INVENTORY mutation, and never executes a write. It
 * converts an already-computed deterministic quantity run plan (produced by the
 * existing replay -> toQuantityRequirementsHandoff -> quantity adapter chain)
 * into snapshot-bound QUANTITY REQUIREMENTS row proposals for the current
 * household week, plus the list of stale rows bound to a superseded snapshot.
 *
 * Release of these proposals remains an explicit human approval step handled by
 * the existing write/approval boundary; nothing here approves anything.
 */

import type { ReconciliationStatus } from "../state-engine/types";
import type { QuantityRunPlan } from "../quantity-adapter/types";

/** Airtable-shaped QUANTITY REQUIREMENTS row fields this seam writes. */
export interface QuantityRequirementRowDraft {
  Requirement: string;
  Meal: string[];
  Item: string;
  "Required quantity": number;
  Unit: string;
  "Calculation status": "Calculated";
  "Household state snapshot ID": string;
  "State reconciliation status": ReconciliationStatus;
}

/** Provenance carried alongside each proposed row (never inferred downstream). */
export interface QuantityRequirementProvenance {
  snapshotId: string;
  replayId: string;
  replayTimestamp: string;
  reconciliationStatus: ReconciliationStatus;
  sourceEventIds: string[];
  weekStartIso: string;
  weekEndIso: string;
}

export interface ProposedQuantityRequirement {
  requirementId: string;
  itemKey: string;
  fields: QuantityRequirementRowDraft;
  provenance: QuantityRequirementProvenance;
}

/** An existing Airtable QUANTITY REQUIREMENTS row observed for this week. */
export interface ExistingQuantityRequirementRow {
  recordId: string;
  requirementId?: string | null;
  itemKey: string;
  snapshotId?: string | null;
}

export type MaterialisationRefusalCode =
  | "RECONCILIATION_BLOCKED"
  | "QUANTITY_RUN_REFUSED"
  | "MISSING_CURRENT_WEEK_MEALS"
  | "NO_REQUIREMENTS_DERIVED";

export interface MaterialisationRefusal {
  code: MaterialisationRefusalCode;
  detail: string;
}

export interface CurrentWeekQuantityMaterialisation {
  /** False whenever the run is refused; callers must not write anything. */
  ok: boolean;
  /** Always false: this seam never writes and never approves. */
  executed: false;
  approvalRequired: true;
  snapshotId: string;
  replayId: string;
  replayTimestamp: string;
  reconciliationStatus: ReconciliationStatus;
  weekStartIso: string;
  weekEndIso: string;
  mealPlanIds: string[];
  /** Rows to append for this snapshot (excludes rows already bound to it). */
  proposals: ProposedQuantityRequirement[];
  /** Rows already bound to this snapshot; re-running proposes nothing new. */
  unchangedRequirementIds: string[];
  /** Existing rows bound to a different (stale) snapshot; never reused. */
  staleRecordIds: string[];
  refusals: MaterialisationRefusal[];
}

export interface CurrentWeekQuantityMaterialisationInput {
  plan: QuantityRunPlan;
  weekStartIso: string;
  weekEndIso: string;
  /** Current-week Production MEAL PLANS record IDs. */
  mealPlanIds: readonly string[];
  existingRows?: readonly ExistingQuantityRequirementRow[];
}
