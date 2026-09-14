import { describe, expect, it } from "vitest";

import {
  changedPrefill,
  someLeftPrefill,
  wholeAmountGonePrefill,
} from "@/lib/household-input/action-shortcuts";
import type { OperatorInventoryItem } from "@/lib/operator-inventory.functions";

const mince: OperatorInventoryItem = {
  id: "rec-1",
  item: "beef mince",
  quantity: 2,
  unit: "pack",
  location: "Fridge",
  category: "Meat",
  status: "",
  bestBefore: null,
} as unknown as OperatorInventoryItem;

const loose: OperatorInventoryItem = {
  id: "rec-2",
  item: "fresh coriander",
  quantity: null,
  unit: null,
  location: "Fridge",
  category: "Herbs",
  status: "",
  bestBefore: null,
} as unknown as OperatorInventoryItem;

describe("household action shortcuts", () => {
  it("whole-amount-gone sets the amount left to exactly zero and keeps the unit", () => {
    expect(wholeAmountGonePrefill(mince)).toEqual({ item: "beef mince", quantity: "0", unit: "pack" });
  });

  it("whole-amount-gone never invents a unit for an uncounted item", () => {
    const prefill = wholeAmountGonePrefill(loose);
    expect(prefill.quantity).toBe("0");
    expect(prefill.unit).toBe("");
  });

  it("some-left leaves the amount blank for the human to state", () => {
    expect(someLeftPrefill(mince)).toEqual({ item: "beef mince", quantity: "", unit: "pack" });
  });

  it("changed pre-fills the recorded amount so the human corrects it", () => {
    expect(changedPrefill(mince)).toEqual({ item: "beef mince", quantity: "2", unit: "pack" });
  });

  it("changed leaves the amount blank when nothing is recorded", () => {
    expect(changedPrefill(loose)).toEqual({ item: "fresh coriander", quantity: "", unit: "" });
  });

  it("never mutates the source item", () => {
    wholeAmountGonePrefill(mince);
    expect(mince.quantity).toBe(2);
  });

  describe("one-tap All gone action", () => {
    it("pre-fills exactly zero left and keeps the original unit", () => {
      expect(wholeAmountGonePrefill(mince)).toEqual({ item: "beef mince", quantity: "0", unit: "pack" });
    });

    it("stays fail-closed for uncounted items by never inventing a unit", () => {
      expect(wholeAmountGonePrefill(loose)).toEqual({ item: "fresh coriander", quantity: "0", unit: "" });
    });
  });
});

