import { describe, expect, it } from "vitest";

import { describeCycle, describeReconciliation, type CycleInput } from "./cycle-state";


const base: CycleInput = {
  shopReady: false,
  shopApproved: false,
  deliveryKnown: false,
  deliveryApproved: false,
  receiptConfirmed: false,
};

describe("household cycle state", () => {
  it("keeps an approved basket separate from food confirmed at home", () => {
    const view = describeCycle({ ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true });
    expect(view.stage).toBe("DELIVERY_TO_CONFIRM");
    expect(view.tone).not.toBe("good");
    expect(view.action).toEqual({ label: "Confirm the delivery", to: "/delivery" });
    expect(`${view.shopping} ${view.delivery}`).toMatch(/not counted as food at home/i);
    expect(`${view.shopping} ${view.delivery}`).not.toMatch(/everything.*counted in|shop is done/i);
  });

  it("stays action-oriented when the shop is approved but nothing has landed", () => {
    const view = describeCycle({ ...base, shopReady: true, shopApproved: true });
    expect(view.stage).toBe("SHOP_ON_ITS_WAY");
    expect(view.action.to).toBe("/delivery");
    expect(view.delivery).toMatch(/until you confirm/i);
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
    expect(`${view.shopping} ${view.delivery}`).toMatch(/shop is done.*counted in/i);
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

describe("reconciliation card state", () => {
  const base: CycleInput = {
    shopReady: false,
    shopApproved: false,
    deliveryKnown: false,
    deliveryApproved: false,
    receiptConfirmed: false,
  };

  const planned = {
    retailer: "Tesco",
    lines: [
      { itemKey: "Kerrygold Butter 250G", quantity: 1, unit: "pack" },
      { itemKey: "Tesco Chicken Breast", quantity: 2, unit: "pack" },
    ],
  };

  it("says nothing is due when there is no shop to review", () => {
    const view = describeReconciliation(base, null);
    expect(view.headline).toBe("Nothing to check");
    expect(view.tone).toBe("neutral");
    expect(view.action).toBeNull();
  });

  it("shows planned lines and points to the shop before approval", () => {
    const view = describeReconciliation({ ...base, shopReady: true }, planned);
    expect(view.headline).toBe("Shop still to review");
    expect(view.action).toEqual({ label: "Review the shop", to: "/shop" });
    expect(view.lines).toHaveLength(2);
  });

  it("keeps approved-but-not-arrived shopping uncounted and action-oriented", () => {
    const view = describeReconciliation({ ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true }, planned);
    expect(view.headline).toBe("Not confirmed yet");
    expect(view.tone).toBe("attention");
    expect(view.action).toEqual({ label: "Confirm what arrived", to: "/delivery" });
    expect(view.body).toMatch(/not recorded what physically arrived/i);
  });

  it("is only reassuring when receipt is explicitly proven", () => {
    const view = describeReconciliation({ ...base, shopReady: true, shopApproved: true, deliveryKnown: true, deliveryApproved: true, receiptConfirmed: true }, planned);
    expect(view.headline).toBe("Counted in");
    expect(view.tone).toBe("good");
    expect(view.action).toEqual({ label: "Update what's at home", to: "/food" });
  });

  it("handles an empty planned basket gracefully", () => {
    const view = describeReconciliation({ ...base, shopReady: true }, { retailer: "Tesco", lines: [] });
    expect(view.body).toMatch(/agree the shop first/i);
    expect(view.lines).toHaveLength(0);
  });
});

