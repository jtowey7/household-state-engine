import { describe, expect, it } from "vitest";

import { matchExistingInventory } from "./inventory-match";

const inv = (recordId: string, item: string) => ({ recordId, item });

describe("matchExistingInventory", () => {
  it("finds a unique strong match for a clean subset name", () => {
    const result = matchExistingInventory("mince", [
      inv("rec-1", "Beef mince"),
      inv("rec-2", "Salmon fillet"),
      inv("rec-3", "Butter"),
    ]);
    expect(result).toEqual({ kind: "unique", match: inv("rec-1", "Beef mince") });
  });

  it("matches ignoring pluralisation and packaging words", () => {
    const result = matchExistingInventory("packs of carrots", [inv("rec-1", "Carrot")]);
    expect(result).toEqual({ kind: "unique", match: inv("rec-1", "Carrot") });
  });

  it("prefers an exact canonical name over broader candidates", () => {
    const result = matchExistingInventory("Milk", [
      inv("rec-1", "Milk"),
      inv("rec-2", "Milk chocolate"),
    ]);
    expect(result).toEqual({ kind: "unique", match: inv("rec-1", "Milk") });
  });

  it("refuses to guess when several inventory items plausibly match", () => {
    const result = matchExistingInventory("mince", [
      inv("rec-1", "Beef mince"),
      inv("rec-2", "Pork mince"),
    ]);
    expect(result).toEqual({
      kind: "ambiguous",
      candidates: [inv("rec-1", "Beef mince"), inv("rec-2", "Pork mince")],
    });
  });

  it("reports no match when nothing overlaps", () => {
    expect(matchExistingInventory("quinoa", [inv("rec-1", "Beef mince")])).toEqual({ kind: "none" });
  });

  it("never matches on a weak partial overlap", () => {
    expect(matchExistingInventory("chicken stock cubes", [inv("rec-1", "Chicken thighs")])).toEqual({
      kind: "none",
    });
  });

  it("reports no match for an empty or insignificant description", () => {
    expect(matchExistingInventory("   ", [inv("rec-1", "Beef mince")])).toEqual({ kind: "none" });
    expect(matchExistingInventory("of a", [inv("rec-1", "Beef mince")])).toEqual({ kind: "none" });
  });
});
