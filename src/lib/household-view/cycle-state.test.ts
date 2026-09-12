import { describe, expect, it } from "vitest";

import { describeCycle, type CycleInput } from "./cycle-state";

const base: CycleInput = {
  shopReady: false,
  shopApproved: false,
  deliveryKnown: false,
  deliveryApproved: false,
  receiptConfirmed: false,
};

describe("household cycle state", () => {
  it("never treats an approved delivery as proof that food arrived", () => {
    const view = describeCycle({ ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true });
    expect(view.stage).toBe("ARRIVED_TO_CHECK");
    expect(view.tone).not.toBe("good");
    expect(view.action).toEqual({ label: "Check what arrived", to: "/delivery" });
  });

  it("stays action-oriented when the shop is approved but nothing has landed", () => {
    const view = describeCycle({ ...base, shopReady: true, shopApproved: true });
    expect(view.stage).toBe("SHOP_ON_ITS_WAY");
    expect(view.action.to).toBe("/delivery");
  });

  it("does not go quiet just because a plan or basket exists", () => {
    const view = describeCycle({ ...base, shopReady: true });
    expect(view.stage).toBe("SHOP_TO_REVIEW");
    expect(view.tone).toBe("attention");
  });

  it("is reassuring only when receipt and reconciliation are explicitly proven", () => {
    const view = describeCycle({ ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true, receiptConfirmed: true });
    expect(view.stage).toBe("ALL_SETTLED");
    expect(view.tone).toBe("good");
    expect(view.action.to).toBe("/food");
  });

  it("uses no internal status or infrastructure words", () => {
    const inputs: CycleInput[] = [
      base,
      { ...base, shopReady: true },
      { ...base, shopReady: true, shopApproved: true },
      { ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true },
      { ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true, receiptConfirmed: true },
    ];
    for (const input of inputs) {
      const view = describeCycle(input);
      const text = `${view.shopping} ${view.delivery} ${view.action.label}`;
      expect(text).not.toMatch(/not[_ ]?ready|approved|pending|agent|database|reconcil|status/i);
    }
  });
});
