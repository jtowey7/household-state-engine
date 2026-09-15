import { describe, expect, it } from "vitest";

import { filterBrowsableFoods, matchesFoodSearch } from "./inventory-browse";

const food = (item: string) => ({ item });

const inventory = [food("Milk"), food("Frozen peas"), food("Rice"), food("Mystery jar")];

describe("household food browsing", () => {
  it("finds food by name only", () => {
    expect(matchesFoodSearch(food("Milk"), "mil")).toBe(true);
    expect(matchesFoodSearch(food("Milk"), "Milk")).toBe(true);
    expect(matchesFoodSearch(food("Milk"), "fridge")).toBe(false);
    expect(matchesFoodSearch(food("Milk"), "dairy")).toBe(false);
  });

  it("returns everything when nothing is typed", () => {
    expect(filterBrowsableFoods(inventory, {})).toHaveLength(4);
    expect(filterBrowsableFoods(inventory, { query: "  " })).toHaveLength(4);
  });

  it("filters by the typed name", () => {
    expect(filterBrowsableFoods(inventory, { query: "ri" }).map((i) => i.item)).toEqual(["Rice"]);
    expect(filterBrowsableFoods(inventory, { query: "peas" }).map((i) => i.item)).toEqual([
      "Frozen peas",
    ]);
    expect(filterBrowsableFoods(inventory, { query: "fridge" })).toEqual([]);
  });
});
