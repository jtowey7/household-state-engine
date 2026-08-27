import { describe, expect, it } from "vitest";

import { mapAirtableMealPlanRow } from "./airtable-meal-input";

describe("Airtable People-link validation", () => {
  it("rejects a Production meal when a valid People link is mixed with a blank link", () => {
    const result = mapAirtableMealPlanRow({
      id: "recMealBlankPerson",
      fields: {
        "Record class": "Production",
        Recipe: [{ id: "recRecipe" }],
        People: [{ id: "recPerson1" }, { id: "   " }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("INVALID_SERVING_INPUT");
      expect(result.rejection.detail).toMatch(/blank|malformed/i);
    }
  });

  it("rejects a Production meal when a People entry is malformed rather than an Airtable link", () => {
    const result = mapAirtableMealPlanRow({
      id: "recMealMalformedPerson",
      fields: {
        "Record class": "Production",
        Recipe: [{ id: "recRecipe" }],
        People: [{ id: "recPerson1" }, { name: "not-a-record-link" }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("INVALID_SERVING_INPUT");
  });
});
