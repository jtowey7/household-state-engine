import { describe, expect, it } from "vitest";

import {
  browsableLocations,
  filterBrowsableFoods,
  isBrowsableValue,
  matchesFoodSearch,
} from "./inventory-browse";

const food = (item: string, location?: string | null) => ({ item, location });

const inventory = [
  food("Milk", "Fridge"),
  food("Beef mince", "Freezer"),
  food("Rice", "Cupboard"),
  food("Mystery jar", "Needs a home"),
];

describe("food browsing context", () => {
  it("offers only real locations as filters", () => {
    expect(browsableLocations(inventory)).toEqual(["Cupboard", "Freezer", "Fridge"]);
  });

  it("treats placeholder context as no context at all", () => {
    expect(isBrowsableValue("Needs a home")).toBe(false);
    expect(isBrowsableValue("  ")).toBe(false);
    expect(isBrowsableValue("Fridge")).toBe(true);
  });

  it("searches by name and location only", () => {
    expect(matchesFoodSearch(food("Milk", "Fridge"), "fridge")).toBe(true);
    expect(matchesFoodSearch(food("Milk", "Fridge"), "mil")).toBe(true);
    expect(matchesFoodSearch(food("Milk", "Fridge"), "dairy")).toBe(false);
    expect(matchesFoodSearch(food("Milk", "Fridge"), "freezer")).toBe(false);
  });

  it("never matches a placeholder location through search", () => {
    expect(matchesFoodSearch(food("Mystery jar", "Needs a home"), "needs a home")).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(filterBrowsableFoods(inventory, {})).toHaveLength(4);
  });

  it("filters by location together with the search text", () => {
    expect(filterBrowsableFoods(inventory, { location: "Fridge" }).map((i) => i.item)).toEqual([
      "Milk",
    ]);
    expect(filterBrowsableFoods(inventory, { location: "Freezer", query: "milk" })).toEqual([]);
    expect(
      filterBrowsableFoods(inventory, { location: "Cupboard", query: "rice" }).map((i) => i.item),
    ).toEqual(["Rice"]);
  });
});
