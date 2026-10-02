import { describe, expect, it } from "vitest";
import { categoriseItem, normaliseInventoryName, CATEGORY_ORDER } from "./categorise";

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

describe("normaliseInventoryName", () => {
  it("strips a leading supermarket brand — the product is the same regardless of shop", () => {
    expect(normaliseInventoryName("Tesco Whole Cucumber Each")).toBe("Whole Cucumber");
    expect(normaliseInventoryName("Tesco Celery")).toBe("Celery");
    expect(normaliseInventoryName("Sainsbury's Basmati Rice 1Kg")).toBe("Basmati Rice");
  });

  it("strips a trailing size/count suffix that just repeats the quantity/unit fields", () => {
    expect(normaliseInventoryName("Tesco Tomato Passata 500G")).toBe("Tomato Passata");
    expect(normaliseInventoryName("Tesco Vanilla Ice Cream 900Ml")).toBe("Vanilla Ice Cream");
    expect(normaliseInventoryName("Tesco Crumpets 6 Pack")).toBe("Crumpets");
    expect(normaliseInventoryName("Tesco Southern Fried Chicken Wrap (C)")).toBe(
      "Southern Fried Chicken Wrap",
    );
  });

  it("re-capitalises the first letter when stripping a brand leaves a lowercase start", () => {
    expect(normaliseInventoryName("Allinson's strong white bread flour")).toBe(
      "Strong white bread flour",
    );
  });

  it("leaves an already-clean name untouched", () => {
    expect(normaliseInventoryName("Onions")).toBe("Onions");
    expect(normaliseInventoryName("Romaine lettuce")).toBe("Romaine lettuce");
  });

  it("is idempotent — running it again on its own output is a no-op", () => {
    const once = normaliseInventoryName("Tesco Lean Beef Steak Mince 5% Fat 750g");
    expect(normaliseInventoryName(once)).toBe(once);
  });

  it("collapses repeated whitespace", () => {
    expect(normaliseInventoryName("Tesco   Celery")).toBe("Celery");
  });
});
