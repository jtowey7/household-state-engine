import { describe, expect, it } from "vitest";
import { buildProductionMealDemand } from "./production-meal-input";

describe("buildProductionMealDemand", () => {
  it("uses distinct People links as the authoritative serving count", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "meal-2",
        recipeId: "recipe-b",
        people: ["person-2", "person-1", "person-3"],
        recordClass: "Production",
      },
    ]);

    expect(result.rejections).toEqual([]);
    expect(result.meals).toEqual([
      { mealPlanId: "meal-2", recipeId: "recipe-b", servings: 3 },
    ]);
  });

  it("accepts the plural linked-recipe shape when exactly one recipe is linked", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "meal-3",
        recipeIds: ["recipe-c"],
        people: ["person-1"],
        recordClass: "Production",
      },
    ]);

    expect(result.rejections).toEqual([]);
    expect(result.meals).toEqual([
      { mealPlanId: "meal-3", recipeId: "recipe-c", servings: 1 },
    ]);
  });

  it("refuses ambiguous multiple linked recipes rather than silently selecting one", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "meal-ambiguous",
        recipeIds: ["recipe-a", "recipe-b"],
        people: ["person-1", "person-2"],
        recordClass: "Production",
      },
    ]);

    expect(result.meals).toEqual([]);
    expect(result.rejections).toEqual([
      {
        mealPlanId: "meal-ambiguous",
        code: "AMBIGUOUS_RECIPE",
        detail:
          "Production meal does not resolve to exactly one linked recipe; demand cannot be generated.",
      },
    ]);
  });

  it("refuses blank People rather than falling back to household size or recipe servings", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "meal-1",
        recipeId: "recipe-a",
        people: [],
        recordClass: "Production",
      },
    ]);

    expect(result.meals).toEqual([]);
    expect(result.rejections).toEqual([
      {
        mealPlanId: "meal-1",
        code: "MISSING_SERVING_INPUT",
        detail:
          "Production meal has no authoritative People links; servings are not inferred.",
      },
    ]);
  });

  it("refuses duplicate or blank People links", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "meal-1",
        recipeId: "recipe-a",
        people: ["person-1", "person-1"],
        recordClass: "Production",
      },
      {
        mealPlanId: "meal-2",
        recipeId: "recipe-b",
        people: ["person-2", ""],
        recordClass: "Production",
      },
    ]);

    expect(result.meals).toEqual([]);
    expect(result.rejections.map((r) => r.code)).toEqual([
      "INVALID_SERVING_INPUT",
      "INVALID_SERVING_INPUT",
    ]);
  });

  it("requires exactly one linked recipe", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "missing",
        recordClass: "Production",
        people: ["person-1"],
      },
      {
        mealPlanId: "present",
        recipeId: "recipe-a",
        recordClass: "Production",
        people: ["person-1"],
      },
    ]);

    expect(result.meals).toEqual([
      { mealPlanId: "present", recipeId: "recipe-a", servings: 1 },
    ]);
    expect(result.rejections).toEqual([
      {
        mealPlanId: "missing",
        code: "MISSING_RECIPE",
        detail: "Production meal has no linked recipe; demand cannot be generated.",
      },
    ]);
  });

  it("ignores synthetic Test rows", () => {
    const result = buildProductionMealDemand([
      {
        mealPlanId: "test-meal",
        recipeId: "test-recipe",
        people: ["person-1", "person-2"],
        recordClass: "Test",
      },
      {
        mealPlanId: "production-meal",
        recipeId: "production-recipe",
        people: ["person-1", "person-2"],
        recordClass: "Production",
      },
    ]);

    expect(result.rejections).toEqual([]);
    expect(result.meals).toEqual([
      {
        mealPlanId: "production-meal",
        recipeId: "production-recipe",
        servings: 2,
      },
    ]);
  });
});
