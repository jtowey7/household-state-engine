import { describe, expect, it } from "vitest";

import {
  COMMON_FOOD_UNITS,
  normalizeFoodUnit,
} from "./inventory-presentation";

describe("inventory presentation", () => {
  it("normalises common unit aliases without silently converting meaning", () => {
    expect(normalizeFoodUnit("packs")).toBe("pack");
    expect(normalizeFoodUnit("kilograms")).toBe("kg");
    expect(normalizeFoodUnit("tins")).toBe("tin/can");
    expect(normalizeFoodUnit("litres")).toBe("litre");
    expect(normalizeFoodUnit("handful")).toBe("handful");
  });

  it("keeps the common unit vocabulary finite and user-facing", () => {
    expect(COMMON_FOOD_UNITS).toEqual([
      "pack",
      "bag",
      "box",
      "bottle",
      "tin/can",
      "tub",
      "jar",
      "carton",
      "loaf",
      "kg",
      "g",
      "litre",
      "ml",
    ]);
  });

  it("presents the physical place only, never a classification", () => {
    expect(compactInventoryContext("fridge")).toEqual({ location: "Fridge" });
    expect(compactInventoryContext(" cupboard ")).toEqual({ location: "Cupboard" });
  });

  it("gracefully omits missing or placeholder context", () => {
    expect(compactInventoryContext("Needs a home")).toEqual({ location: null });
    expect(compactInventoryContext("")).toEqual({ location: null });
  });
});
