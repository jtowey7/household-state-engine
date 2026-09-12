import { describe, expect, it } from "vitest";

import { describeProvision } from "./provision-state";
import type { CanonicalBasketReadResult } from "../procurement/canonical-basket";

const notReady: CanonicalBasketReadResult = {
  status: "NOT_READY",
  source: "AIRTABLE_CANONICAL",
  reason: "NO_REVIEWABLE_BASKET",
  detail: "x",
};

const ready = (lines: number): CanonicalBasketReadResult => ({
  status: "READY",
  source: "AIRTABLE_CANONICAL",
  basket: { totalCost: 13.7, lines: Array.from({ length: lines }, () => ({})) } as never,
  approval: { status: "PENDING", judgeId: "j" } as never,
});

describe("household provision state", () => {
  it("is meal-led and reassuring when everything is covered", () => {
    const p = describeProvision({ basket: notReady, daysNeedingShopping: 0 });
    expect(p.state).toBe("PLENTIFUL");
    expect(p.line1).toMatch(/plenty/i);
    expect(p.primary?.to).toBe("/week");
  });

  it("surfaces shopping naturally when a canonical basket is ready", () => {
    const p = describeProvision({ basket: ready(3), daysNeedingShopping: 2 });
    expect(p.state).toBe("REPLENISH_SOON");
    expect(p.primary).toEqual({ label: "Order the shop", to: "/shop" });
    expect(p.secondary?.label).toBe("Make what we have last");
    expect(p.line2).toMatch(/3 things/);
  });

  it("offers a plain-language recovery choice when the shop is unconfirmed", () => {
    const p = describeProvision({ basket: notReady, daysNeedingShopping: 2 });
    expect(p.state).toBe("SHOP_UNCONFIRMED");
    expect(p.primary?.label).toBe("Order the shop");
    expect(p.secondary?.label).toBe("Make what we have last");
  });

  it("leads with settling an uncertain item when there is one", () => {
    const p = describeProvision({
      basket: notReady,
      daysNeedingShopping: 0,
      uncertainItemLabel: "Butter",
    });
    expect(p.state).toBe("SHOP_UNCONFIRMED");
    expect(p.primary).toEqual({ label: "Settle butter", to: "/sweep" });
  });

  it("uses no internal status labels anywhere in household copy", () => {
    const cases = [
      describeProvision({ basket: null, daysNeedingShopping: 0 }),
      describeProvision({ basket: notReady, daysNeedingShopping: 0 }),
      describeProvision({ basket: notReady, daysNeedingShopping: 3 }),
      describeProvision({ basket: ready(1), daysNeedingShopping: 1 }),
    ];
    for (const c of cases) {
      const text = [c.line1, c.line2, c.shoppingHeading, c.shoppingBody, c.primary?.label, c.secondary?.label]
        .filter(Boolean)
        .join(" ");
      expect(text).not.toMatch(/not ready|approved|NOT_READY|snapshot|replay|canonical/i);
    }
  });

  it("never claims a shop is ready while the canonical read is pending", () => {
    const p = describeProvision({ basket: null, daysNeedingShopping: 4 });
    expect(p.state).toBe("CHECKING");
    expect(p.primary).toBeNull();
  });
});
