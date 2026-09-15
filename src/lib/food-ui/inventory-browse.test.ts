import { describe, expect, it } from "vitest";

import {
  browsableCategories,
  browsableLocations,
  filterBrowsableFoods,
  isBrowsableValue,
  matchesFoodSearch,
} from "./inventory-browse";

const food = (item: string, location?: string | null, category?: string | null) => ({
  item,
  location,
  category,
});

const inventory = [
  food("Milk", "Fridge", "Dairy"),
  food("Beef mince", "Freezer", "Meat & alternatives"),
  food("Rice", "Cupboard", "Packets & dry goods"),
  food("Mystery jar", "Needs a home", "Needs a category"),
];

describe("food browsing context", () => {
  it("offers only real locations and categories as filters", () => {
    expect(browsableLocations(inventory)).toEqual(["Cupboard", "Freezer", "Fridge"]);
    expect(browsableCategories(inventory)).toEqual([
      "Dairy",
      "Meat & alternatives",
      "Packets & dry goods",
    ]);
  });

  it("treats placeholder context as no context at all", () => {
    expect(isBrowsableValue("Needs a home")).toBe(false);
    expect(isBrowsableValue("  ")).toBe(false);
    expect(isBrowsableValue("Fridge")).toBe(true);
  });

  it("searches by name, location and category", () => {
    expect(matchesFoodSearch(food("Milk", "Fridge", "Dairy"), "fridge")).toBe(true);
    expect(matchesFoodSearch(food("Milk", "Fridge", "Dairy"), "dairy")).toBe(true);
    expect(matchesFoodSearch(food("Milk", "Fridge", "Dairy"), "mil")).toBe(true);
    expect(matchesFoodSearch(food("Milk", "Fridge", "Dairy"), "freezer")).toBe(false);
  });

  it("never matches a placeholder location through search", () => {
    expect(matchesFoodSearch(food("Mystery jar", "Needs a home"), "needs a home")).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(filterBrowsableFoods(inventory, {})).toHaveLength(4);
  });

  it("filters by location and category together with the search text", () => {
    expect(filterBrowsableFoods(inventory, { location: "Fridge" }).map((i) => i.item)).toEqual([
      "Milk",
    ]);
    expect(filterBrowsableFoods(inventory, { category: "Dairy" }).map((i) => i.item)).toEqual([
      "Milk",
    ]);
    expect(
      filterBrowsableFoods(inventory, { location: "Freezer", query: "milk" }),
    ).toEqual([]);
    expect(
      filterBrowsableFoods(inventory, { location: "Cupboard", query: "rice" }).map((i) => i.item),
    ).toEqual(["Rice"]);
  });
});
