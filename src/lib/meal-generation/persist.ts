/**
 * Selected-plan-only persistence for the meal generation seam.
 *
 * Boundaries this file must keep:
 * - only meals the household explicitly selected are ever persisted;
 * - rows are shaped for the existing MEAL PLANS field contract; no second
 *   meal schema is introduced;
 * - a planned meal NEVER produces a stock, consumption or procurement effect.
 */

import type { MealCandidate, MealPlanDraftRow, MealPlanPersistencePort, SelectedMeal } from "./types";

export const PLANNED_MEAL_STATUS = "Planned";
export const PLANNED_MEAL_RECORD_CLASS = "Household";
export const PLANNED_MEAL_TYPE = "Dinner";

/** Narrows generated candidates to exactly what the household chose to keep. */
export function selectMeals(
  candidates: readonly MealCandidate[],
  selectedIds: readonly string[],
  people: number,
): SelectedMeal[] {
  const wanted = new Set(selectedIds);
  return candidates
    .filter((candidate) => wanted.has(candidate.candidateId))
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      plannedFor: candidate.plannedFor,
      why: candidate.why,
      people,
      components: candidate.components,
    }))
    .sort((a, b) => a.plannedFor.localeCompare(b.plannedFor));
}

export function toMealPlanRows(selected: readonly SelectedMeal[]): MealPlanDraftRow[] {
  return selected.map((meal) => ({
    Meal: meal.label,
    Date: meal.plannedFor,
    "Meal type": PLANNED_MEAL_TYPE,
    "Why this meal": meal.why,
    Status: PLANNED_MEAL_STATUS,
    "Record class": PLANNED_MEAL_RECORD_CLASS,
    People: meal.people,
  }));
}

export type PersistResult =
  | { ok: true; persistedMealCount: number; ids: string[]; stockEffects: 0 }
  | { ok: false; reason: string };

/**
 * Persists the selected week only. Refuses when nothing was selected, so an
 * empty confirmation can never be mistaken for a saved week.
 */
export async function persistSelectedWeek(
  selected: readonly SelectedMeal[],
  port: MealPlanPersistencePort,
): Promise<PersistResult> {
  if (selected.length === 0) return { ok: false, reason: "Choose at least one meal before saving the week." };
  if (selected.length > 7) return { ok: false, reason: "A week can hold at most seven meals." };

  const rows = toMealPlanRows(selected);
  try {
    const result = await port.appendPlannedMeals(rows);
    return { ok: true, persistedMealCount: rows.length, ids: result.ids, stockEffects: 0 };
  } catch {
    return { ok: false, reason: "FoodOS could not save this week. Nothing has been changed." };
  }
}

/** In-memory port used by tests and the demo journey. Writes nothing real. */
export function createMemoryMealPlanPort(): MealPlanPersistencePort & { rows: MealPlanDraftRow[] } {
  const rows: MealPlanDraftRow[] = [];
  return {
    rows,
    async appendPlannedMeals(incoming) {
      rows.push(...incoming);
      return { ids: incoming.map((row, index) => `plan-${rows.length - incoming.length + index + 1}`) };
    },
  };
}
