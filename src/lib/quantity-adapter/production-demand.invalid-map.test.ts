import { describe, expect, it } from "vitest";

import type { ItemKeyMapEntry } from "./item-key-map";
import { buildProductionDemandTargets } from "./production-demand";

describe("Production demand item-key-map safety", () => {
  it("withholds an alias when an active mapping has an invalid conversion factor", () => {
    const map: ItemKeyMapEntry[] = [
      {
        alias: "flour",
        canonicalItemKey: "plain-flour",
        sourceUnit: "g",
        canonicalUnit: "g",
        conversionFactor: 0,
      },
    ];

    const result = buildProductionDemandTargets(
      [{ mealPlanId: "meal-1", recipeId: "r1", servings: 6 }],
      [
        {
          recipeId: "r1",
          ingredientName: "flour",
          baseQuantity: 500,
          baseUnit: "g",
          baseServings: 6,
        },
      ],
      map,
    );

    expect(result.targets).toEqual([]);
    expect(result.rejections).toEqual([
      {
        code: "INVALID_ITEM_KEY_MAP",
        ingredientName: "flour",
        detail: "Active ITEM KEY MAP contains an invalid conversion factor for this alias; demand withheld.",
      },
    ]);
  });
});
