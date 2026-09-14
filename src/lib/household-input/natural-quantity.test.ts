import { describe, expect, it } from "vitest";

import { parseNaturalQuantity } from "./natural-quantity";

describe("parseNaturalQuantity", () => {
  it("parses a worded count with a pack unit and drops the linking word", () => {
    expect(parseNaturalQuantity("two packs of mince")).toEqual({
      resolved: true,
      item: "mince",
      quantity: 2,
      unit: "pack",
    });
  });

  it("treats an article as a single unit", () => {
    expect(parseNaturalQuantity("a bag of frozen peas")).toEqual({
      resolved: true,
      item: "frozen peas",
      quantity: 1,
      unit: "bag",
    });
  });

  it("parses a fused metric amount", () => {
    expect(parseNaturalQuantity("500g mince")).toEqual({
      resolved: true,
      item: "mince",
      quantity: 500,
      unit: "g",
    });
  });

  it("parses a spaced metric amount", () => {
    expect(parseNaturalQuantity("1.5 kg potatoes")).toEqual({
      resolved: true,
      item: "potatoes",
      quantity: 1.5,
      unit: "kg",
    });
  });

  it("does not guess when no amount is stated", () => {
    expect(parseNaturalQuantity("mince")).toEqual({ resolved: false, item: "mince" });
  });

  it("does not guess when the unit is unknown", () => {
    expect(parseNaturalQuantity("two handfuls of rice")).toEqual({
      resolved: false,
      item: "two handfuls of rice",
    });
  });

  it("does not guess from an amount with no item", () => {
    expect(parseNaturalQuantity("two packs")).toEqual({ resolved: false, item: "two packs" });
  });

  it("parses an article-prefixed compound count", () => {
    expect(parseNaturalQuantity("a couple of packs of mince")).toEqual({
      resolved: true,
      item: "mince",
      quantity: 2,
      unit: "pack",
    });
  });

  it("parses an article-prefixed dozen with a unit", () => {
    expect(parseNaturalQuantity("a dozen boxes of eggs")).toEqual({
      resolved: true,
      item: "eggs",
      quantity: 12,
      unit: "box",
    });
  });

  it("parses a worded count linked to its unit by 'of'", () => {
    expect(parseNaturalQuantity("two of packs of mince")).toEqual({
      resolved: true,
      item: "mince",
      quantity: 2,
      unit: "pack",
    });
  });

  it("does not guess when an article-prefixed count has no unit", () => {
    expect(parseNaturalQuantity("a couple of mince")).toEqual({
      resolved: false,
      item: "a couple of mince",
    });
  });

  it("does not guess when an article-prefixed count has no item", () => {
    expect(parseNaturalQuantity("a couple of packs")).toEqual({
      resolved: false,
      item: "a couple of packs",
    });
  });

  it("returns an empty unresolved parse for blank input", () => {
    expect(parseNaturalQuantity("   ")).toEqual({ resolved: false, item: "" });
  });
});
