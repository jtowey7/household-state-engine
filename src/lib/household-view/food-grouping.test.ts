import { describe, expect, it } from "vitest";

import { groupFoods, groupNameForFood } from "./food-grouping";

describe("household food grouping", () => {
  it("never drops an item when location and category are missing", () => {
    const items = [
      { item: "butter", location: "", category: "" },
      { item: "mystery jar", location: "", category: "" },
      { item: "chicken thighs", location: "", category: "" },
    ];
    const grouped = groupFoods(items);
    expect(grouped.flatMap(([, list]) => list)).toHaveLength(3);
  });

  it("falls back to Other rather than blocking an unrecognised food", () => {
    expect(groupNameForFood({ item: "mystery jar" })).toBe("Other");
    expect(groupNameForFood({ item: "" })).toBe("Other");
  });

  it("uses canonical category before the forgiving name fallback", () => {
    expect(groupNameForFood({ item: "peas", category: "Fresh produce" })).toBe("Fresh food");
    expect(groupNameForFood({ item: "salmon fillet", category: "Frozen" })).toBe("Frozen");
    expect(groupNameForFood({ item: "mystery bottle", category: "Drinks" })).toBe("Drinks");
  });

  it("uses forgiving item-name grouping when category is missing or unfamiliar", () => {
    expect(groupNameForFood({ item: "Salmon fillet" })).toBe("Meat & fish");
    expect(groupNameForFood({ item: "Basmati rice" })).toBe("Cupboard");
    expect(groupNameForFood({ item: "Orange juice" })).toBe("Drinks");
    expect(groupNameForFood({ item: "Frozen peas" })).toBe("Frozen");
    expect(groupNameForFood({ item: "Baby spinach" })).toBe("Fresh food");
    expect(groupNameForFood({ item: "Basmati rice", category: "World foods" })).toBe("Cupboard");
  });

  it("places each item in exactly one group, in a stable order", () => {
    const items = [
      { item: "rice" },
      { item: "salmon" },
      { item: "widget" },
      { item: "spinach" },
    ];
    const a = groupFoods(items).map(([g, l]) => [g, l.length]);
    const b = groupFoods(items).map(([g, l]) => [g, l.length]);
    expect(a).toEqual(b);
    expect(a).toEqual([
      ["Fresh food", 1],
      ["Meat & fish", 1],
      ["Cupboard", 1],
      ["Other", 1],
    ]);
  });

  it("returns no empty groups", () => {
    expect(groupFoods([{ item: "widget" }])).toEqual([["Other", [{ item: "widget" }]]]);
  });
});
