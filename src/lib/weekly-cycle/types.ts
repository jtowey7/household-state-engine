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
import type { DeliveryInventoryTransition, ReconciledDelivery } from "../state-engine/delivery-inventory";
import type { DemandTarget, QuantityRunPlan } from "../quantity-adapter/types";
import type { CandidateBasket, CatalogueEntry } from "../procurement/types";
import type { ConsumptionPlan, ConsumptionProjection } from "../consumption/types";
import type { AppendProposal } from "../event-writer/propose";
import type { StockExceptionFingerprint, StockExceptionProposalRun, UserReportedStockException } from "../inventory-exception/types";
import type { MealCompletionProposalRun, MealProposalFingerprint, PlannedMealCompletion } from "../meal-completion/types";
import type { CycleFeedbackGate } from "../feedback/cycle-gate";
import type { FeedbackReport } from "../feedback/types";
import type { LoadedProductionState, ProductionStatePort, SourceScope } from "../production-adapter/types";
import type { HumanDeliveryEvidence } from "../state-engine/delivery-evidence";

export type CycleStageId = "LOAD_SOURCE" | "PROJECT_CONSUMPTION" | "RECEIVE_DELIVERY" | "PROPOSE_APPEND" | "REPLAY" | "HANDOFF" | "FEEDBACK_GATE" | "QUANTITY_PLAN" | "AGGREGATE_PROCUREMENT" | "APPROVAL_GATE";
export type StageStatus = "OK" | "WARNED" | "REFUSED" | "FAILED" | "SKIPPED";
export interface CycleStage { stage: CycleStageId; status: StageStatus; detail: string; metrics: Record<string, number | string | boolean>; warnings: string[]; }
export interface ApprovalGate { required: true; granted: false; readyForReview: boolean; reason: string; }
export interface WeeklyCycleRun {
  cycleId: string; scope: SourceScope; asOf: string; stages: CycleStage[]; source: LoadedProductionState | null; projection: ConsumptionProjection | null;
  appendProposals: AppendProposal[]; mealProposals: MealCompletionProposalRun | null; exceptionProposals: StockExceptionProposalRun | null; feedbackGate: CycleFeedbackGate | null;
  deliveryTransitions: DeliveryInventoryTransition[]; snapshot: StateSnapshot | null; handoff: QuantityRequirementsHandoff | null; plan: QuantityRunPlan | null; basket: CandidateBasket | null; approval: ApprovalGate;
  isolatedItemKeys: string[]; readonly mutatedHouseholdState: false; readonly appendedEvents: false; readonly dispatched: false; status: "COMPLETED" | "REFUSED" | "FAILED";
}
export interface WeeklyCycleOptions {
  port: ProductionStatePort; scope: SourceScope; plan: Omit<ConsumptionPlan, "openingEvents">; asOf: string; now?: () => string;
  demandTargets?: DemandTarget[]; mealCompletions?: readonly PlannedMealCompletion[]; knownMealProposals?: readonly MealProposalFingerprint[];
  stockExceptions?: readonly UserReportedStockException[]; knownStockExceptions?: readonly StockExceptionFingerprint[];
  feedbackReports?: readonly FeedbackReport[]; feedbackSubjectItemKeys?: Readonly<Record<string, readonly string[]>>;
  deliveries?: readonly ReconciledDelivery[];
  /** Sealed human delivery evidence from the runtime/operator handoff. Verified and proposed through the canonical HOUSEHOLD EVENTS path; never written or dispatched here. */
  deliveryEvidence?: readonly HumanDeliveryEvidence[];
  catalogue?: readonly CatalogueEntry[];
}
