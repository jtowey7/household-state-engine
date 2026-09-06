/**
 * FoodOS — WEEKLY MEAL PLAN VIEW from the replayed household stock readout.
 *
 * Presentation-facing composition seam only. It reads the existing
 * QUANTITY REQUIREMENTS handoff (produced by the approved stock readout replay)
 * and the planned meals for the week, and reports coverage per meal.
 *
 * It holds no connector, proposes no events, and cannot express a Production
 * household mutation or any retailer I/O. When the handoff is not safe to plan
 * from, it fails closed instead of inventing stock.
 */

import type { PlannedComponent } from "../consumption/types";

/** A planned meal for the household week. Synthetic or household-entered. */
export interface PlannedWeekMeal {
  mealId: string;
  /** Household-readable name, e.g. "Chicken traybake". */
  label: string;
  /** ISO-8601 instant the meal is planned for. Drives deterministic ordering. */
  plannedFor: string;
  /** Only meals still to be cooked draw on current stock. */
  state: "PLANNED" | "DUE" | "COMPLETED" | "SKIPPED" | "CHANGED";
  components: readonly PlannedComponent[];
  note?: string;
}

export type WeekMealCoverage =
  /** Everything this meal needs is already counted. */
  | "COVERED"
  /** Counted, but not enough of at least one ingredient. */
  | "SHORT"
  /** At least one ingredient has never been counted. */
  | "NOT_COUNTED"
  /** An ingredient is blocked or in an incomparable unit — never guessed. */
  | "NEEDS_CHECK"
  /** The meal is already cooked, skipped or replanned. */
  | "NOT_PLANNED";

export interface WeekMealComponentLine {
  itemKey: string;
  needed: number;
  unit: string;
  /** Stock still available to this meal after earlier meals in the week. */
  available: number;
  shortfall: number;
  coverage: WeekMealCoverage;
  /** Plain-language reason, no engine terminology. */
  because: string;
}

export interface WeekMealPlanLine {
  mealId: string;
  label: string;
  plannedFor: string;
  coverage: WeekMealCoverage;
  components: readonly WeekMealComponentLine[];
  note?: string;
}

export interface WeekPlanShortfall {
  itemKey: string;
  quantity: number;
  unit: string;
}

export interface HouseholdWeekPlan {
  /** Provenance of the stock this plan was worked out from. */
  readonly source: "HOUSEHOLD_STOCK_READOUT";
  replayId: string;
  snapshotId: string;
  /** False when the handoff is not safe to plan from; nothing is invented. */
  readyForPlanning: boolean;
  /** Set when readyForPlanning is false. */
  blockedReason: string | null;
  meals: readonly WeekMealPlanLine[];
  /** Aggregated remaining need across the week, in the units planned. */
  shortfalls: readonly WeekPlanShortfall[];
  /** Ingredients the household has never counted. */
  notCountedItemKeys: readonly string[];
  readonly productionMutation: false;
}
