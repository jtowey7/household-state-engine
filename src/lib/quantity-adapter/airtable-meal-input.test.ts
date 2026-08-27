import { describe, expect, it } from "vitest";
import {
  buildProductionMealDemandFromAirtable,
  mapAirtableMealPlanRow,
} from "./airtable-meal-input";

describe("Airtable Production meal input", () => {
  it("maps linked Recipe and People records without inferring servings", () => {
    const result = mapAirtableMealPlanRow({
      id: "rec-meal-1",
      fields: {
        "Record class": "Production",
        Recipe: [{ id: "rec-recipe-1", name: "Chilli con carne" }],
        People: [{ id: "rec-person-1", name: "Adult" }, { id: "rec-person-2", name: "Child" }],
      },
    });

    expect(result).toEqual({
      ok: true,
      row: {
        mealPlanId: "rec-meal-1",
        recipeId: "rec-recipe-1",
        people: ["rec-person-1", "rec-person-2"],
        recordClass: "Production",
      },
    });
  });

  it("fails closed when a Production meal has no People links", () => {
    const result = mapAirtableMealPlanRow({
      id: "rec-meal-2",
      fields: { "Record class": "Production", Recipe: [{ id: "rec-recipe-1" }], People: [] },
    });

    expect(result).toEqual({
      ok: false,
      rejection: {
        mealPlanId: "rec-meal-2",
        code: "MISSING_SERVING_INPUT",
        detail: "Production meal has no People links; servings cannot be inferred.",
      },
    });
  });

  it("rejects multiple linked recipes rather than choosing one", () => {
    const result = mapAirtableMealPlanRow({
      id: "rec-meal-3",
      fields: {
        "Record class": "Production",
        Recipe: [{ id: "rec-a" }, { id: "rec-b" }],
        People: [{ id: "rec-person-1" }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("AMBIGUOUS_RECIPE");
  });

  it("ignores Test rows in the demand builder", () => {
    const result = buildProductionMealDemandFromAirtable([
      {
        id: "rec-test",
        fields: { "Record class": "Test", Recipe: [{ id: "rec-test-recipe" }], People: [{ id: "rec-person" }] },
      },
      {
        id: "rec-prod",
        fields: { "Record class": "Production", Recipe: [{ id: "rec-prod-recipe" }], People: [{ id: "rec-person" }] },
      },
    ]);

    expect(result.meals).toEqual([
      { mealPlanId: "rec-prod", recipeId: "rec-prod-recipe", servings: 1 },
    ]);
    expect(result.rejections).toEqual([]);
  });

  it("rejects legacy serving fields instead of treating them as authoritative", () => {
    const result = mapAirtableMealPlanRow({
      id: "rec-meal-4",
      fields: {
        "Record class": "Production",
        Recipe: [{ id: "rec-recipe-1" }],
        People: [{ id: "rec-person-1" }],
        Servings: 6,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("LEGACY_FIELD_SCHEMA");
  });
});
