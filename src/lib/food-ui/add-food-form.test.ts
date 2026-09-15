import { describe, expect, it } from "vitest";

import {
  ADD_FOOD_PRIMARY_LABEL,
  describeAddFoodForm,
  describeExistingFoodChoice,
} from "./add-food-form";
import { parseNaturalQuantity } from "../household-input/natural-quantity";

describe("Add food form semantics", () => {
  it("asks for the food first when nothing is entered", () => {
    const state = describeAddFoodForm({ item: "", quantity: "", unit: "" });
    expect(state.complete).toBe(false);
    expect(state.hint).toContain("Start with the food");
  });

  it("asks for amount and unit together once the food is named", () => {
    const state = describeAddFoodForm({ item: "milk", quantity: "", unit: "" });
    expect(state.complete).toBe(false);
    expect(state.hint).toBe("Add how much came home, and what it is measured in.");
  });

  it("asks only for the missing half of the amount", () => {
    expect(describeAddFoodForm({ item: "milk", quantity: "", unit: "pints" }).hint).toBe(
      "Add how much came home.",
    );
    expect(describeAddFoodForm({ item: "milk", quantity: "2", unit: "" }).hint).toContain(
      "measured in",
    );
  });

  it("offers one primary action only when food, amount and unit are all present", () => {
    const state = describeAddFoodForm({ item: "milk", quantity: "2", unit: "pints" });
    expect(state.complete).toBe(true);
    expect(state.primaryLabel).toBe(ADD_FOOD_PRIMARY_LABEL);
    expect(state.hint).toBeNull();
    expect(state.summary).toBe("2 pints of milk");
  });

  it("keeps the primary label stable while incomplete", () => {
    expect(describeAddFoodForm({ item: "", quantity: "", unit: "" }).primaryLabel).toBe(
      ADD_FOOD_PRIMARY_LABEL,
    );
  });

  it("refuses a non-numeric or negative amount without guessing", () => {
    expect(describeAddFoodForm({ item: "milk", quantity: "lots", unit: "pints" }).complete).toBe(false);
    expect(describeAddFoodForm({ item: "milk", quantity: "-1", unit: "pints" }).complete).toBe(false);
  });

  it("never exposes internal contract terminology", () => {
    const inputs = [
      { item: "", quantity: "", unit: "" },
      { item: "milk", quantity: "", unit: "" },
      { item: "milk", quantity: "2", unit: "" },
      { item: "milk", quantity: "", unit: "pints" },
    ];
    for (const input of inputs) {
      const text = `${describeAddFoodForm(input).hint ?? ""} ${describeAddFoodForm(input).primaryLabel}`;
      expect(text).not.toMatch(/MISSING_UNIT|STOCK_CORRECTION|canonical|payload|approval|event id/i);
    }
  });

  it("completes directly from a natural description the parser resolves", () => {
    const parsed = parseNaturalQuantity("2 litres of milk");
    expect(parsed.resolved).toBe(true);
    if (!parsed.resolved) return;
    const state = describeAddFoodForm({
      item: parsed.item,
      quantity: String(parsed.quantity),
      unit: parsed.unit,
    });
    expect(state.complete).toBe(true);
    expect(state.summary).toBe("2 l of milk");
  });

  it("stays incomplete when the description cannot be resolved", () => {
    const parsed = parseNaturalQuantity("some milk");
    expect(parsed.resolved).toBe(false);
    const state = describeAddFoodForm({ item: parsed.item, quantity: "", unit: "" });
    expect(state.complete).toBe(false);
  });
});
