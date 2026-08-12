/**
 * Food OS — end-to-end SHADOW weekly cycle (isolated orchestrator).
 *
 * Chains the proven seams in one deterministic pass:
 *   production-state adapter (read-only)
 *     -> consumption projector (planned burn-down + exceptions)
 *     -> State Engine replay
 *     -> QUANTITY REQUIREMENTS handoff
 *     -> quantity/procurement adapter
 *     -> human approval gate (always outside the calculation)
 *
 * The cycle is shadow-only: it never writes household state and never
 * dispatches procurement. Every stage reports status so failures are visible
 * rather than silent.
 */

import type { StateSnapshot, QuantityRequirementsHandoff } from "../state-engine/types";
import type { DemandTarget, QuantityRunPlan } from "../quantity-adapter/types";
import type { CandidateBasket, CatalogueEntry } from "../procurement/types";
import type { ConsumptionPlan, ConsumptionProjection } from "../consumption/types";
import type { AppendProposal } from "../event-writer/propose";
import type { StockExceptionFingerprint, StockExceptionProposalRun, UserReportedStockException } from "../inventory-exception/types";
import type {
  MealCompletionProposalRun,
  MealProposalFingerprint,
  PlannedMealCompletion,
} from "../meal-completion/types";
import type { CycleFeedbackGate } from "../feedback/cycle-gate";
import type { FeedbackReport } from "../feedback/types";
import type { LoadedProductionState, ProductionStatePort, SourceScope } from "../production-adapter/types";

export type CycleStageId =
  | "LOAD_SOURCE"
  | "PROJECT_CONSUMPTION"
  | "PROPOSE_APPEND"
  | "REPLAY"
  | "HANDOFF"
  | "FEEDBACK_GATE"
  | "QUANTITY_PLAN"
  | "AGGREGATE_PROCUREMENT"
  | "APPROVAL_GATE";

export type StageStatus = "OK" | "WARNED" | "REFUSED" | "FAILED" | "SKIPPED";

export interface CycleStage {
  stage: CycleStageId;
  status: StageStatus;
  detail: string;
  /** Deterministic, human-readable counters for observability. */
  metrics: Record<string, number | string | boolean>;
  warnings: string[];
}

export interface ApprovalGate {
  /** Human approval is always required; the runtime never self-approves. */
  required: true;
  granted: false;
  /** True only when a human could meaningfully be asked to approve. */
  readyForReview: boolean;
  reason: string;
}

export interface WeeklyCycleRun {
  cycleId: string;
  scope: SourceScope;
  asOf: string;
  stages: CycleStage[];
  source: LoadedProductionState | null;
  projection: ConsumptionProjection | null;
  /**
   * PROPOSE_APPEND output: canonical HOUSEHOLD EVENTS rows that a human could
   * authorise. Proposals only — the cycle holds no write connector.
   */
  appendProposals: AppendProposal[];
  /**
   * PLANNED MEAL COMPLETION -> canonical Consumption proposals, deduped across
   * repeated scheduler evaluations. Proposals only; nothing is written.
   */
  mealProposals: MealCompletionProposalRun | null;
  /**
   * USER-REPORTED INVENTORY EXCEPTION -> canonical Correction proposals,
   * deduped by exception identity. Proposals only; nothing is written and
   * INVENTORY is never mutated.
   */
  exceptionProposals: StockExceptionProposalRun | null;
  /**
   * FEEDBACK propagation gate evaluated before quantity/procurement. Hard
   * constraints refuse the gated areas; durable preferences stay proposals.
   */
  feedbackGate: CycleFeedbackGate | null;
  snapshot: StateSnapshot | null;
  handoff: QuantityRequirementsHandoff | null;
  plan: QuantityRunPlan | null;
  /** Aggregated candidate basket. Never dispatched. */
  basket: CandidateBasket | null;
  approval: ApprovalGate;
  /** Item keys isolated anywhere in the chain; unrelated planning continued. */
  isolatedItemKeys: string[];
  /** Shadow cycle: nothing is ever written or purchased. */
  readonly mutatedHouseholdState: false;
  /** No event was appended to any connector by this cycle. */
  readonly appendedEvents: false;
  readonly dispatched: false;
  status: "COMPLETED" | "REFUSED" | "FAILED";
}

export interface WeeklyCycleOptions {
  port: ProductionStatePort;
  scope: SourceScope;
  /** Meals / allocations / exceptions. Opening events come from the source. */
  plan: Omit<ConsumptionPlan, "openingEvents">;
  asOf: string;
  now?: () => string;
  /**
   * Demand targets from weekly meal/quantity planning. The production event
   * source does not supply par levels; when omitted, a planning-shaped port's
   * own targets are used.
   */
  demandTargets?: DemandTarget[];
  /** Completed planned meals evaluated in the PROPOSE_APPEND stage only. */
  mealCompletions?: readonly PlannedMealCompletion[];
  /** Fingerprints from earlier scheduler runs, so nothing is queued twice. */
  knownMealProposals?: readonly MealProposalFingerprint[];
  /** Explicit user-reported stock exceptions evaluated as Correction proposals. */
  stockExceptions?: readonly UserReportedStockException[];
  /** Exception fingerprints from earlier runs, so nothing is queued twice. */
  knownStockExceptions?: readonly StockExceptionFingerprint[];
  /** Household FEEDBACK reports evaluated by the propagation gate. */
  feedbackReports?: readonly FeedbackReport[];
  /** Maps a feedback subject onto demand item keys (defaults to identity). */
  feedbackSubjectItemKeys?: Readonly<Record<string, readonly string[]>>;
  /** Synthetic retailer catalogue used to build the candidate basket. */
  catalogue?: readonly CatalogueEntry[];
}
