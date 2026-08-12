/**
 * Food OS — planned-meal-driven consumption projection (isolated seam).
 *
 * Scope boundary: this module turns a SYNTHETIC meal plan + daily allocations +
 * consumption exceptions into deterministic HOUSEHOLD EVENTS consumed by the
 * existing State Engine. It performs no I/O and is not connected to Airtable
 * or to real household data. Core replay semantics are unchanged.
 */

import type { HouseholdEvent } from "../state-engine/types";

export type MealState =
  /** Scheduled in the future; never burns. */
  | "PLANNED"
  /** Reached its due date; assumed consumed unless an exception says otherwise. */
  | "DUE"
  /** Explicitly completed; assumed consumed at the planned quantity. */
  | "COMPLETED"
  /** Explicitly skipped; never burns, even once the date passes. */
  | "SKIPPED"
  /** Explicitly changed/replanned; never burns under this meal id. */
  | "CHANGED";

export interface PlannedComponent {
  itemKey: string;
  /** Planned household quantity — no portion-level reporting is required. */
  quantity: number;
  unit: string;
}

export interface PlannedMeal {
  mealId: string;
  /** ISO-8601 instant the meal is due. */
  plannedFor: string;
  state: MealState;
  components: PlannedComponent[];
  /**
   * Leftovers are only inventoried when explicitly planned. Normal leftovers
   * are intentionally untracked to minimise friction.
   */
  plannedLeftovers?: PlannedComponent[];
}

export interface DailyAllocation {
  allocationId: string;
  itemKey: string;
  /** e.g. one ice cream per person per day. */
  quantityPerPersonPerDay: number;
  unit: string;
  people: number;
  /** Inclusive ISO date (YYYY-MM-DD) the allocation starts. */
  startDate: string;
  /** Inclusive ISO date the allocation ends. */
  endDate: string;
}

export type ConsumptionExceptionType =
  /** Consumed outside any plan — reported, never manual inventory editing. */
  | "UNPLANNED_CONSUMPTION"
  /** Planned meal did not consume its planned quantity. */
  | "NOT_CONSUMED"
  /** Planned meal consumed a different quantity than planned. */
  | "PARTIAL_CONSUMPTION"
  /** Quantity unknown — isolate the item, keep everything else planning. */
  | "UNCERTAIN_QUANTITY";

export interface ConsumptionException {
  exceptionId: string;
  type: ConsumptionExceptionType;
  itemKey: string;
  /** Required for UNPLANNED_CONSUMPTION and PARTIAL_CONSUMPTION. */
  quantity?: number;
  unit?: string;
  /** Required for NOT_CONSUMED / PARTIAL_CONSUMPTION. */
  mealId?: string;
  occurredAt: string;
  note?: string;
}

export interface ConsumptionPlan {
  meals?: PlannedMeal[];
  allocations?: DailyAllocation[];
  exceptions?: ConsumptionException[];
  /** Opening balances, as ordinary household events. */
  openingEvents?: HouseholdEvent[];
}

export type ConsumptionDecisionCode =
  | "MEAL_ASSUMED_CONSUMED"
  | "MEAL_NOT_DUE"
  | "MEAL_SKIPPED"
  | "MEAL_CHANGED"
  | "MEAL_OVERRIDDEN_BY_EXCEPTION"
  | "PLANNED_LEFTOVER_RETURNED"
  | "ALLOCATION_BURNED"
  | "UNPLANNED_CONSUMPTION_APPLIED"
  | "ITEM_UNCERTAIN_ISOLATED";

export interface ConsumptionDecision {
  code: ConsumptionDecisionCode;
  /** Meal, allocation or exception id this decision came from. */
  sourceId: string;
  itemKey: string | null;
  detail: string;
}

export interface ConsumptionProjection {
  /** Deterministic, replayable, idempotent household events. */
  events: HouseholdEvent[];
  /** Items isolated by uncertainty; unrelated planning continues. */
  uncertainItemKeys: string[];
  decisions: ConsumptionDecision[];
}

export interface ProjectOptions {
  /** Evaluation instant; meals due at or before this are assumed consumed. */
  asOf: string;
}
