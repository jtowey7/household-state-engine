/**
 * Food OS — PLANNED MEAL COMPLETION -> CANONICAL CONSUMPTION PROPOSAL (types).
 *
 * Boundary: this seam turns a completed planned meal into `AppendIntent`
 * Consumption proposals on the EXISTING canonical writer path
 * (`prepareAppend` / `canonicaliseAppend`). It invents no parallel event
 * schema, holds no connector, and can never write Airtable or mutate
 * INVENTORY. Human approval and the write boundary are unchanged.
 */

import type { CanonicalAppendRecord } from "../event-writer/types";
import type { PreparedAppend } from "../event-writer/preview";
import type { AppendIntent } from "../write-boundary/types";
import type { RecordClass } from "../state-engine/types";

export type MealCompletionState =
  /** Scheduled; not yet consumed. */
  | "PLANNED"
  /** Explicitly completed; assumed consumed at the planned quantity. */
  | "COMPLETED"
  /** Explicitly skipped; never consumes. */
  | "SKIPPED"
  /** Explicitly cancelled; never consumes. */
  | "CANCELLED"
  /** Replanned. The superseded plan must never silently consume. */
  | "CHANGED";

export interface MealIngredientLine {
  itemKey: string;
  /** Planned household quantity. Missing/NaN is an exception, never a guess. */
  quantity?: number | null;
  unit?: string | null;
}

export interface PlannedMealCompletion {
  mealId: string;
  /** Identity of THIS completion. Drives the proposal's occurred-at. */
  completionId: string;
  /** Recipe / meal provenance, preserved into evidence. */
  recipeId?: string;
  mealName?: string;
  plannedFor: string;
  /** Instant the meal reached completion. Defaults to `plannedFor`. */
  completedAt?: string;
  state: MealCompletionState;
  ingredients: MealIngredientLine[];
  /** For a CHANGED plan: the completion identity that replaces it. */
  replacedByCompletionId?: string;
  /** Meal-plan identity this completion belongs to. */
  mealPlanId?: string;
  actor?: string;
  source?: string;
  confidence?: string;
  evidence?: string;
  recordClass?: RecordClass;
  /** Prior event IDs this completion supersedes (e.g. a partial state). */
  supersedes?: string[];
}

export type MealProposalExceptionCode =
  | "MEAL_NOT_COMPLETED"
  | "MEAL_SKIPPED"
  | "MEAL_CANCELLED"
  | "MEAL_CHANGED_AWAITING_REPLACEMENT"
  | "MISSING_QUANTITY"
  | "MISSING_UNIT"
  | "UNIT_MISMATCH"
  | "ZERO_QUANTITY"
  | "INVALID_QUANTITY"
  | "PROPOSAL_PAYLOAD_CONFLICT"
  | "PROPOSAL_PROVENANCE_CONFLICT"
  | "CANONICALISATION_REJECTED";

export interface MealProposalException {
  code: MealProposalExceptionCode;
  mealId: string;
  completionId: string;
  itemKey: string | null;
  detail: string;
}

/** Stable fingerprint of one (meal completion, item) proposal. */
export interface MealProposalFingerprint {
  /** `${completionId}::${itemKey}` — the dedupe key across scheduler runs. */
  proposalKey: string;
  eventId: string;
  payloadHash: string;
  /** Hash of the preserved provenance fields. */
  provenanceHash: string;
}

export interface MealConsumptionProposal extends MealProposalFingerprint {
  mealId: string;
  completionId: string;
  mealPlanId: string | null;
  recipeId: string | null;
  itemKey: string;
  quantity: number;
  unit: string;
  occurredAt: string;
  intent: AppendIntent;
  record: CanonicalAppendRecord;
  /** Preview only: `wouldWrite: false`, no port anywhere. */
  preview: PreparedAppend;
  /** True when an equivalent proposal already existed and was not re-queued. */
  duplicateOfExisting: boolean;
  readonly requiresHumanAuthorization: true;
}

export interface MealCompletionProposalRun {
  /** Newly queued proposals (deduped). */
  proposals: MealConsumptionProposal[];
  /** Proposals suppressed because an identical one already exists. */
  deduped: MealProposalFingerprint[];
  exceptions: MealProposalException[];
  /** Every fingerprint known after this run — feed back on the next run. */
  fingerprints: MealProposalFingerprint[];
}

export interface MealCompletionProposalOptions {
  now: () => string;
  /** Fingerprints from earlier scheduler evaluations. */
  knownProposals?: readonly MealProposalFingerprint[];
  actor?: string;
  source?: string;
  confidence?: string;
  recordClass?: RecordClass;
  /** Units the household contract accepts. */
  allowedUnits?: readonly string[];
}
