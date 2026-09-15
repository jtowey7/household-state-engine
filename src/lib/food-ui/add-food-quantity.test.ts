import { describe, expect, it } from "vitest";

import { resolveAddedAmount } from "./add-food-quantity";

const existing = [
  { item: "Milk", quantity: 2, unit: "litres" },
  { item: "Mince", quantity: 1, unit: "pack" },
  { item: "Bread", quantity: null, unit: "each" },
];

describe("adding food to an existing item", () => {
  it("adds the new amount to what is already there", () => {
    const result = resolveAddedAmount({ item: "milk", quantity: 3, unit: "litres", existing });
    expect(result).toEqual({ ok: true, stateAfter: 5, stateBefore: 2, matchedItem: "Milk" });
  });

  it("treats equivalent everyday words as the same measure", () => {
    const result = resolveAddedAmount({ item: "Milk", quantity: 1, unit: "l", existing });
    expect(result.ok && result.stateAfter).toBe(3);
  });

  it("starts a new food when nothing matches", () => {
    const result = resolveAddedAmount({ item: "Butter", quantity: 2, unit: "packs", existing });
    expect(result).toEqual({ ok: true, stateAfter: 2, stateBefore: null, matchedItem: null });
  });

  it("refuses to mix measures or to add to an unknown amount", () => {
    const mixed = resolveAddedAmount({ item: "Milk", quantity: 500, unit: "ml", existing });
    expect(mixed.ok).toBe(false);
    const unknown = resolveAddedAmount({ item: "Bread", quantity: 1, unit: "each", existing });
    expect(unknown.ok).toBe(false);
  });

  it("refuses an unrecognised measure and a zero amount in plain words", () => {
    const odd = resolveAddedAmount({ item: "Milk", quantity: 1, unit: "bunches", existing });
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.message).not.toMatch(/MISSING_UNIT|contract|canonical/i);
    expect(resolveAddedAmount({ item: "Milk", quantity: 0, unit: "litres", existing }).ok).toBe(false);
  });
});
