import { describe, expect, it } from "vitest";
import { categoriseItem, CATEGORY_ORDER } from "./categorise";

describe("categoriseItem", () => {
  it("matches common grocery items to a sensible aisle", () => {
    expect(categoriseItem("Beef mince")).toBe("Meat & fish");
    expect(categoriseItem("Chicken breast")).toBe("Meat & fish");
    expect(categoriseItem("Semi-skimmed milk")).toBe("Dairy & eggs");
    expect(categoriseItem("Cheddar cheese")).toBe("Dairy & eggs");
    expect(categoriseItem("Granary bread")).toBe("Bread & bakery");
    expect(categoriseItem("Basmati rice")).toBe("Tins & packets");
    expect(categoriseItem("Orange juice")).toBe("Drinks");
    expect(categoriseItem("Milk chocolate")).toBe("Snacks & treats");
    expect(categoriseItem("Carrots")).toBe("Fruit & veg");
  });

  it("prefers preparation state over ingredient — tinned and frozen win", () => {
    // Would otherwise match Fruit & veg via "tomato"/"pea".
    expect(categoriseItem("Tinned tomatoes")).toBe("Tins & packets");
    expect(categoriseItem("Frozen peas")).toBe("Frozen");
    expect(categoriseItem("Pulled pork (frozen)")).toBe("Frozen");
  });

  it("doesn't let a short word false-match inside an unrelated longer keyword", () => {
    // "tea" is a substring of "steak" — must not land in Meat & fish.
    expect(categoriseItem("Tea")).toBe("Drinks");
  });

  it("is case-insensitive", () => {
    expect(categoriseItem("CHICKEN NUGGETS")).toBe("Meat & fish");
  });

  it("falls back to Other rather than guessing", () => {
    expect(categoriseItem("Birthday candles")).toBe("Other");
    expect(categoriseItem("")).toBe("Other");
  });

  it("every keyword-matched category is a real entry in CATEGORY_ORDER", () => {
    const sample = [
      "Beef mince",
      "Milk",
      "Bread",
      "Rice",
      "Juice",
      "Chocolate",
      "Carrots",
      "Mystery item",
    ];
    for (const name of sample) {
      expect(CATEGORY_ORDER).toContain(categoriseItem(name));
    }
  });

  it("Other is last in the aisle order", () => {
    expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe("Other");
  });
});
