import { resolveDemandTargets, type ItemKeyMapEntry } from "./item-key-map";
import type { DemandTarget } from "./types";

/**
 * Canonical planning input for one recipe ingredient.
 * The ingredient name is resolved through the authoritative item-key map;
 * no fuzzy matching or unit inference is performed here.
 */
export interface RecipeIngredientDemand {
  recipeId: string;
  ingredientName: string;
  baseQuantity: number | null;
  baseUnit: string;
  baseServings: number;
  packSize?: number;
  packUnit?: string;
}

/** A planned meal occurrence that consumes one recipe at a given serving count. */
export interface MealDemand {
  mealPlanId: string;
  recipeId: string;
  servings: number;
}

export interface DemandBuildRejection {
  code:
    | "MISSING_QUANTITY"
    | "INVALID_SERVINGS"
    | "MISSING_RECIPE"
    | "UNIT_MISMATCH"
    | "AMBIGUOUS_ALIAS"
    | "UNMAPPED_ALIAS"
    | "INVALID_ITEM_KEY_MAP";
  ingredientName: string;
  detail: string;
}

export interface ProductionDemandBuild {
  targets: DemandTarget[];
  rejections: DemandBuildRejection[];
}

/**
 * Build the deterministic demand universe for a production meal window.
 *
 * Recipe ingredients are first scaled from recipe base servings to the meal's
 * planned servings, then aggregated by recipe ingredient vocabulary. The
 * authoritative ITEM KEY MAP is applied once, after aggregation, so aliases
 * with conflicting active mappings cannot silently split or overwrite demand.
 * Ingredients without a numeric quantity or an evidence-backed item identity
 * are rejected rather than guessed.
 */
export function buildProductionDemandTargets(
  meals: readonly MealDemand[],
  ingredients: readonly RecipeIngredientDemand[],
  itemKeyMap: readonly ItemKeyMapEntry[],
): ProductionDemandBuild {
  const recipes = new Map<string, RecipeIngredientDemand[]>();
  for (const ingredient of ingredients) {
    const rows = recipes.get(ingredient.recipeId) ?? [];
    rows.push(ingredient);
    recipes.set(ingredient.recipeId, rows);
  }

  const rejections: DemandBuildRejection[] = [];
  const aggregated = new Map<string, DemandTarget>();

  for (const meal of meals) {
    if (!Number.isFinite(meal.servings) || meal.servings <= 0) {
      rejections.push({
        code: "INVALID_SERVINGS",
        ingredientName: meal.recipeId,
        detail: `Meal ${meal.mealPlanId} has invalid servings ${meal.servings}.`,
      });
      continue;
    }

    const recipeIngredients = recipes.get(meal.recipeId);
    if (!recipeIngredients) {
      rejections.push({
        code: "MISSING_RECIPE",
        ingredientName: meal.recipeId,
        detail: `No recipe ingredients found for recipe ${meal.recipeId}.`,
      });
      continue;
    }

    for (const ingredient of recipeIngredients) {
      if (ingredient.baseQuantity === null || !Number.isFinite(ingredient.baseQuantity)) {
        rejections.push({
          code: "MISSING_QUANTITY",
          ingredientName: ingredient.ingredientName,
          detail: "Recipe ingredient has no numeric base quantity; demand is not inferred.",
        });
        continue;
      }
      if (!Number.isFinite(ingredient.baseServings) || ingredient.baseServings <= 0) {
        rejections.push({
          code: "INVALID_SERVINGS",
          ingredientName: ingredient.ingredientName,
          detail: `Recipe base servings must be > 0, received ${ingredient.baseServings}.`,
        });
        continue;
      }
      if (ingredient.baseQuantity <= 0) {
        rejections.push({
          code: "MISSING_QUANTITY",
          ingredientName: ingredient.ingredientName,
          detail: `Recipe base quantity must be > 0, received ${ingredient.baseQuantity}.`,
        });
        continue;
      }

      const quantity = ingredient.baseQuantity * (meal.servings / ingredient.baseServings);
      const prior = aggregated.get(ingredient.ingredientName);
      if (prior) {
        if (prior.unit !== ingredient.baseUnit) {
          rejections.push({
            code: "UNIT_MISMATCH",
            ingredientName: ingredient.ingredientName,
            detail: `Conflicting recipe units for ${ingredient.ingredientName}: ${prior.unit} and ${ingredient.baseUnit}.`,
          });
          continue;
        }
        prior.targetQuantity += quantity;
        continue;
      }

      aggregated.set(ingredient.ingredientName, {
        itemKey: ingredient.ingredientName,
        targetQuantity: quantity,
        unit: ingredient.baseUnit,
        ...(ingredient.packSize !== undefined ? { packSize: ingredient.packSize } : {}),
        ...(ingredient.packUnit !== undefined ? { packUnit: ingredient.packUnit } : {}),
      });
    }
  }

  const activeMappingsByAlias = new Map<string, ItemKeyMapEntry[]>();
  for (const entry of itemKeyMap) {
    if (entry.active === false) continue;
    const rows = activeMappingsByAlias.get(entry.alias) ?? [];
    rows.push(entry);
    activeMappingsByAlias.set(entry.alias, rows);
  }
  const conflictingAliases = new Set<string>();
  const invalidAliases = new Set<string>();
  for (const [alias, rows] of activeMappingsByAlias) {
    const signatures = new Set(
      rows.map((entry) =>
        JSON.stringify({
          canonicalItemKey: entry.canonicalItemKey,
          sourceUnit: entry.sourceUnit,
          canonicalUnit: entry.canonicalUnit,
          conversionFactor: entry.conversionFactor,
        }),
      ),
    );
    if (signatures.size > 1) conflictingAliases.add(alias);
    if (rows.some((entry) => !Number.isFinite(entry.conversionFactor) || entry.conversionFactor <= 0)) {
      invalidAliases.add(alias);
    }
  }

  const filtered = [...aggregated.values()].filter((target) => {
    const mappings = activeMappingsByAlias.get(target.itemKey) ?? [];
    if (conflictingAliases.has(target.itemKey)) {
      rejections.push({
        code: "AMBIGUOUS_ALIAS",
        ingredientName: target.itemKey,
        detail: "Active ITEM KEY MAP contains conflicting mappings for this alias; demand withheld.",
      });
      return false;
    }

    if (invalidAliases.has(target.itemKey)) {
      rejections.push({
        code: "INVALID_ITEM_KEY_MAP",
        ingredientName: target.itemKey,
        detail: "Active ITEM KEY MAP contains an invalid conversion factor for this alias; demand withheld.",
      });
      return false;
    }

    if (mappings.length === 0) {
      rejections.push({
        code: "UNMAPPED_ALIAS",
        ingredientName: target.itemKey,
        detail: "No active ITEM KEY MAP entry exists for this recipe item; demand withheld.",
      });
      return false;
    }

    const unitMappings = mappings.filter((entry) => entry.sourceUnit === target.unit);
    if (unitMappings.length === 0) {
      rejections.push({
        code: "UNIT_MISMATCH",
        ingredientName: target.itemKey,
        detail: `No active ITEM KEY MAP entry matches recipe unit ${target.unit}; demand withheld.`,
      });
      return false;
    }

    return true;
  });

  const resolved = resolveDemandTargets(
    filtered.sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
    itemKeyMap,
  );

  return { targets: resolved.value, rejections };
}
