import type { MealDemand } from "./production-demand";

/**
 * Minimal Airtable-shaped Production MEAL PLANS input.
 *
 * The People links are the authoritative serving decision for this adapter:
 * each distinct linked household member represents one diner for that meal.
 * A blank People field is therefore a hard input gap, not an invitation to
 * infer servings from household size or recipe base servings.
 */
export interface ProductionMealPlanRow {
  mealPlanId: string;
  recipeId?: string | null;
  people?: readonly string[] | null;
  recordClass: "Production" | "Test";
}

export interface ProductionMealDemandRejection {
  mealPlanId: string;
  code:
    | "MISSING_RECIPE"
    | "AMBIGUOUS_RECIPE"
    | "MISSING_SERVING_INPUT"
    | "INVALID_SERVING_INPUT";
  detail: string;
}

export interface ProductionMealDemandInput {
  meals: MealDemand[];
  rejections: ProductionMealDemandRejection[];
}

/**
 * Convert canonical Production MEAL PLANS rows into the MealDemand contract.
 *
 * Test rows are ignored by design. Production rows require exactly one recipe
 * and at least one distinct People link. This function deliberately has no
 * household-size or recipe-base-serving fallback.
 */
export function buildProductionMealDemand(
  rows: readonly ProductionMealPlanRow[],
): ProductionMealDemandInput {
  const rejections: ProductionMealDemandRejection[] = [];
  const meals: MealDemand[] = [];

  for (const row of rows) {
    if (row.recordClass !== "Production") continue;

    const recipeId = row.recipeId?.trim();
    if (!recipeId) {
      rejections.push({
        mealPlanId: row.mealPlanId,
        code: "MISSING_RECIPE",
        detail: "Production meal has no linked recipe; demand cannot be generated.",
      });
      continue;
    }

    const people = row.people ?? [];
    const distinctPeople = new Set(people.map((person) => person.trim()).filter(Boolean));
    if (distinctPeople.size === 0) {
      rejections.push({
        mealPlanId: row.mealPlanId,
        code: "MISSING_SERVING_INPUT",
        detail: "Production meal has no authoritative People links; servings are not inferred.",
      });
      continue;
    }

    if (distinctPeople.size !== people.length) {
      rejections.push({
        mealPlanId: row.mealPlanId,
        code: "INVALID_SERVING_INPUT",
        detail: "Production meal contains duplicate or blank People links; serving input is not trusted.",
      });
      continue;
    }

    meals.push({
      mealPlanId: row.mealPlanId,
      recipeId,
      servings: distinctPeople.size,
    });
  }

  meals.sort((a, b) => a.mealPlanId.localeCompare(b.mealPlanId));
  rejections.sort((a, b) => a.mealPlanId.localeCompare(b.mealPlanId));
  return { meals, rejections };
}
