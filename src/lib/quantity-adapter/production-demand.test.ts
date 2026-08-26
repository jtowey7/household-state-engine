import { describe, expect, it } from "vitest";

import type { ItemKeyMapEntry } from "./item-key-map";
import { buildProductionDemandTargets } from "./production-demand";

describe("Production meal demand target builder", () => {
  const map: ItemKeyMapEntry[] = [
    {
      alias: "chopped tomatoes",
      canonicalItemKey: "tomatoes-tinned",
      sourceUnit: "g",
      canonicalUnit: "g",
      conversionFactor: 1,
    },
    {
      alias: "pasta",
      canonicalItemKey: "pasta-dry",
      sourceUnit: "g",
      canonicalUnit: "g",
      conversionFactor: 1,
    },
  ];

  it("scales recipe quantities to meal servings and aggregates repeated ingredients", () => {
    const result = buildProductionDemandTargets(
      [
        { mealPlanId: "meal-1", recipeId: "r1", servings: 6 },
        { mealPlanId: "meal-2", recipeId: "r1", servings: 3 },
      ],
      [
        {
          recipeId: "r1",
          ingredientName: "pasta",
          baseQuantity: 500,
          baseUnit: "g",
          baseServings: 6,
        },
      ],
      map,
    );

    expect(result.rejections).toEqual([]);
    expect(result.targets).toEqual([
      { itemKey: "pasta-dry", targetQuantity: 750, unit: "g" },
    ]);
  });

  it("does not infer quantities for unquantified ingredients", () => {
    const result = buildProductionDemandTargets(
      [{ mealPlanId: "meal-1", recipeId: "r1", servings: 6 }],
      [
        {
          recipeId: "r1",
          ingredientName: "salt",
          baseQuantity: null,
          baseUnit: "as needed",
          baseServings: 6,
        },
      ],
      map,
    );

    expect(result.targets).toEqual([]);
    expect(result.rejections[0]?.code).toBe("MISSING_QUANTITY");
  });

  it("fails closed on conflicting active aliases but tolerates identical duplicates", () => {
    const result = buildProductionDemandTargets(
      [{ mealPlanId: "meal-1", recipeId: "r1", servings: 6 }],
      [
        {
          recipeId: "r1",
          ingredientName: "chopped tomatoes",
          baseQuantity: 1200,
          baseUnit: "g",
          baseServings: 6,
        },
        {
          recipeId: "r1",
          ingredientName: "pasta",
          baseQuantity: 500,
          baseUnit: "g",
          baseServings: 6,
        },
      ],
      [
        ...map,
        { ...map[0]! },
        {
          alias: "chopped tomatoes",
          canonicalItemKey: "tomato-sauce",
          sourceUnit: "g",
          canonicalUnit: "g",
          conversionFactor: 1,
        },
      ],
    );

    expect(result.targets).toEqual([{ itemKey: "pasta-dry", targetQuantity: 500, unit: "g" }]);
    expect(result.rejections.map((r) => r.code)).toContain("AMBIGUOUS_ALIAS");
  });

  it("rejects a missing recipe and invalid meal servings without guessing", () => {
    const result = buildProductionDemandTargets(
      [
        { mealPlanId: "meal-1", recipeId: "missing", servings: 6 },
        { mealPlanId: "meal-2", recipeId: "r1", servings: 0 },
      ],
      [],
      map,
    );

    expect(result.targets).toEqual([]);
    expect(result.rejections.map((r) => r.code)).toEqual(["MISSING_RECIPE", "INVALID_SERVINGS"]);
  });
});
