/**
 * FoodOS — consumer meal generation seam (Cycle 2A).
 *
 * This module turns a compact household request into CANDIDATE meals for a
 * week. Candidates are proposals only: they are not a meal plan, they never
 * touch household stock, and nothing is persisted until a human selects it.
 *
 * The seam is provider-agnostic. A deterministic in-repo provider is supplied
 * so the household journey works with no external dependency; a real generator
 * can be dropped in behind the same interface.
 */

import type { PlannedComponent } from "../consumption/types";

/** The compact requirements the product already supports asking for. */
export interface MealGenerationRequest {
  /** ISO date (YYYY-MM-DD) of the first day of the week being planned. */
  weekStartIso: string;
  /** How many meals to propose, 1..7. */
  mealCount: number;
  /** How many people each meal must serve. */
  people: number;
  /**
   * Broad household constraints in plain words, e.g. "vegetarian", "no fish".
   * Unrecognised words are simply not applied — nothing is guessed.
   */
  constraints?: readonly string[];
}

/** A proposed meal. Never a household record until explicitly selected. */
export interface MealCandidate {
  candidateId: string;
  label: string;
  /** ISO date (YYYY-MM-DD) the meal is proposed for. */
  plannedFor: string;
  /** Plain-language reason shown to the household. */
  why: string;
  components: readonly PlannedComponent[];
}

export interface MealGenerationProvider {
  readonly id: string;
  generate(request: MealGenerationRequest): MealCandidate[];
}

/** A meal the household explicitly chose to keep for the week. */
export interface SelectedMeal {
  candidateId: string;
  label: string;
  plannedFor: string;
  why: string;
  people: number;
  components: readonly PlannedComponent[];
}

/**
 * The only shape this seam may persist. It maps onto the existing MEAL PLANS
 * field contract and carries no stock, consumption or procurement effect.
 */
export interface MealPlanDraftRow {
  Meal: string;
  Date: string;
  "Meal type": string;
  "Why this meal": string;
  Status: string;
  "Record class": string;
  People: number;
}

export interface MealPlanPersistencePort {
  /** Appends planned-meal rows. Must never write stock or consumption. */
  appendPlannedMeals(rows: readonly MealPlanDraftRow[]): Promise<{ ids: string[] }>;
}
