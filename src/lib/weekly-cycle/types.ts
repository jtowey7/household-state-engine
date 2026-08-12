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
import type { QuantityRunPlan } from "../quantity-adapter/types";
import type { ConsumptionPlan, ConsumptionProjection } from "../consumption/types";
import type { LoadedProductionState, ProductionStatePort, SourceScope } from "../production-adapter/types";

export type CycleStageId =
  | "LOAD_SOURCE"
  | "PROJECT_CONSUMPTION"
  | "REPLAY"
  | "HANDOFF"
  | "QUANTITY_PLAN"
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
  snapshot: StateSnapshot | null;
  handoff: QuantityRequirementsHandoff | null;
  plan: QuantityRunPlan | null;
  approval: ApprovalGate;
  /** Item keys isolated anywhere in the chain; unrelated planning continued. */
  isolatedItemKeys: string[];
  /** Shadow cycle: nothing is ever written or purchased. */
  readonly mutatedHouseholdState: false;
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
}
