import { describe, expect, it } from "vitest";

import { confirmSavedAgainstReadback } from "./save-confirmation";

const ham = { itemKey: "Ham", statedStateAfter: 100, unit: "g" };

describe("a save is only confirmed by the household record reading it back", () => {
  it("confirms Ham 100 g once the food list reads it back", () => {
    const result = confirmSavedAgainstReadback({
      ...ham,
      items: [{ item: "Ham", quantity: 100, unit: "g" }],
    });
    expect(result.confirmed).toBe(true);
    expect(result.label).toBe("Saved");
  });

  it("accepts the same measure written the everyday way", () => {
    const result = confirmSavedAgainstReadback({
      itemKey: "Milk",
      statedStateAfter: 5,
      unit: "litres",
      items: [{ item: "Milk", quantity: 5, unit: "l" }],
    });
    expect(result.confirmed).toBe(true);
  });

  it("does not claim success when the food list has no such food yet", () => {
    const result = confirmSavedAgainstReadback({ ...ham, items: [{ item: "Milk", quantity: 2, unit: "l" }] });
    expect(result.confirmed).toBe(false);
    expect(result.message).toMatch(/not showing in your food list yet/i);
  });

  it("does not claim success when the amount read back differs", () => {
    const result = confirmSavedAgainstReadback({ ...ham, items: [{ item: "Ham", quantity: 40, unit: "g" }] });
    expect(result.confirmed).toBe(false);
    expect(result.message).toMatch(/different amount/i);
  });

  it("does not claim success when the food list could not be read", () => {
    const result = confirmSavedAgainstReadback({ ...ham, items: null });
    expect(result.confirmed).toBe(false);
    expect(result.message).toMatch(/could not read your food list/i);
  });

  it("never exposes internal wording", () => {
    for (const items of [null, [], [{ item: "Ham", quantity: 40, unit: "g" }]]) {
      const result = confirmSavedAgainstReadback({ ...ham, items });
      expect(result.message).not.toMatch(/canonical|event|payload|policy|append|provenance/i);
    }
  });
});
