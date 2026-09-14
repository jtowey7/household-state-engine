import { describe, expect, it } from "vitest";

import { COMMON_UNIT_CHIPS } from "./unit-chips";

describe("common unit chips", () => {
  it("includes the household-requested labels in order", () => {
    expect(COMMON_UNIT_CHIPS).toEqual([
      "packs",
      "each",
      "kg",
      "g",
      "litres",
      "ml",
      "cans",
    ]);
  });

  it("keeps every label lower-case and free-text friendly", () => {
    for (const chip of COMMON_UNIT_CHIPS) {
      expect(chip).toBe(chip.toLowerCase());
      expect(chip).not.toContain(" ");
    }
  });
});
