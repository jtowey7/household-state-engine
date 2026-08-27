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
  recipeIds?: readonly string[] | null;
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
 * Test rows are ignored by design. Production rows require exactly one linked
 * recipe and at least one distinct People link. The plural recipeIds shape
 * preserves the Airtable linked-record cardinality so ambiguity cannot be
 * silently collapsed into a single recipe ID before validation.
 */
export function buildProductionMealDemand(
  rows: readonly ProductionMealPlanRow[],
): ProductionMealDemandInput {
  const rejections: ProductionMealDemandRejection[] = [];
  const meals: MealDemand[] = [];

  for (const row of rows) {
    if (row.recordClass !== "Production") continue;

    const recipeLinks = row.recipeIds ?? (row.recipeId ? [row.recipeId] : []);
    const normalizedRecipeLinks = recipeLinks.map((recipe) => recipe.trim());
    if (normalizedRecipeLinks.length === 0) {
      rejections.push({
        mealPlanId: row.mealPlanId,
        code: "MISSING_RECIPE",
        detail: "Production meal has no linked recipe; demand cannot be generated.",
      });
      continue;
    }

    if (
      normalizedRecipeLinks.length !== 1 ||
      !normalizedRecipeLinks[0] ||
      (row.recipeId && row.recipeIds && row.recipeId.trim() !== normalizedRecipeLinks[0])
    ) {
      rejections.push({
        mealPlanId: row.mealPlanId,
        code: "AMBIGUOUS_RECIPE",
        detail: "Production meal does not resolve to exactly one linked recipe; demand cannot be generated.",
      });
      continue;
    }

    const recipeId = normalizedRecipeLinks[0];
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
