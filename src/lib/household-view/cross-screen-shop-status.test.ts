/**
 * Regression: the week surface and the Shop surface must never contradict
 * each other. A finished meal plan is not a complete, traceable canonical
 * basket, so the week surface may not say the shop is "done" and offer a View
 * link into a Shop screen that has nothing to show.
 */

import { describe, expect, it } from "vitest";

import { describeCycle } from "./cycle-state";
import { describeBasketStatus } from "./basket-status";
import type { CanonicalBasketReadResult } from "../procurement/canonical-basket";

const noCanonicalBasket: CanonicalBasketReadResult = {
  status: "NOT_READY",
  source: "AIRTABLE_CANONICAL",
  reason: "NO_REVIEWABLE_BASKET",
  detail: "BASKET CANDIDATES contains no pending or approved basket with a canonical Basket payload.",
};

describe("cross-screen shopping status", () => {
  it("never offers a shop to view when the Shop surface has no canonical basket", () => {
    const shop = describeBasketStatus(noCanonicalBasket);
    for (const planExists of [false, true]) {
      for (const receiptConfirmed of [false, true]) {
        const week = describeCycle({
          shopReady: false,
          shopApproved: false,
          deliveryKnown: false,
          deliveryApproved: false,
          receiptConfirmed,
          planExists,
        });
        expect(shop.actionable).toBe(false);
        expect(week.shopViewable).toBe(false);
        expect(week.shopping).not.toMatch(/this week's shop is done/i);
      }
    }
  });

  it("says the plan is being worked out when requirements exist but no basket does", () => {
    const week = describeCycle({
      shopReady: false,
      shopApproved: false,
      deliveryKnown: false,
      deliveryApproved: false,
      receiptConfirmed: false,
      planExists: true,
    });
    expect(week.stage).toBe("SHOP_BEING_PREPARED");
    expect(week.shoppingStatus).toBe("Being prepared");
    expect(week.shopping).toMatch(/being worked out/i);
  });

  it("still reports an arrived delivery truthfully without implying a viewable shop", () => {
    const week = describeCycle({
      shopReady: false,
      shopApproved: false,
      deliveryKnown: true,
      deliveryApproved: true,
      receiptConfirmed: true,
    });
    expect(week.stage).toBe("ALL_SETTLED");
    expect(week.shopping).toMatch(/arrived and been counted in/i);
    expect(week.shopViewable).toBe(false);
  });

  it("agrees with the Shop surface when a canonical basket really is ready", () => {
    const ready: CanonicalBasketReadResult = {
      status: "READY",
      source: "AIRTABLE_CANONICAL",
      basket: { totalCost: 10, lines: [] } as never,
      approval: { status: "PENDING", judgeId: "j" },
    };
    expect(describeBasketStatus(ready).actionable).toBe(true);
    expect(
      describeCycle({
        shopReady: true,
        shopApproved: false,
        deliveryKnown: false,
        deliveryApproved: false,
        receiptConfirmed: false,
      }).shopViewable,
    ).toBe(true);
  });
});
