import { describe, expect, it } from "vitest";

import { describeDeliveryScreen } from "./delivery-screen";

const INTERNAL =
  /canonical|provenance|payload|event id|HOUSEHOLD EVENTS|control plane|approval is bound|Production|replay|fingerprint/i;

describe("delivery screen wording", () => {
  it("absorbs a routine successful delivery into one short household line", () => {
    const view = describeDeliveryScreen({ basketReady: true, approvalStatus: "APPROVED", countedIn: true });
    expect(view.stage).toBe("SETTLED");
    expect(view.title).toBe("Your shopping has arrived");
    expect(view.needsHousehold).toBe(false);
    expect(view.body.length).toBeLessThan(120);
  });

  it("treats a just-completed delivery the same as one already counted in", () => {
    const view = describeDeliveryScreen({
      basketReady: true,
      approvalStatus: "APPROVED",
      countedIn: false,
      justCountedIn: true,
    });
    expect(view.stage).toBe("SETTLED");
    expect(view.needsHousehold).toBe(false);
  });

  it("only asks the household for a decision when there is one to make", () => {
    expect(describeDeliveryScreen({ basketReady: true, approvalStatus: "PENDING", countedIn: false }).needsHousehold).toBe(true);
    expect(describeDeliveryScreen({ basketReady: true, approvalStatus: "APPROVED", countedIn: false }).needsHousehold).toBe(true);
    expect(describeDeliveryScreen({ basketReady: false, approvalStatus: null, countedIn: false }).needsHousehold).toBe(false);
  });

  it("never exposes internal or audit vocabulary on any state", () => {
    const states = [
      { basketReady: false, approvalStatus: null, countedIn: false },
      { basketReady: true, approvalStatus: "PENDING" as const, countedIn: false },
      { basketReady: true, approvalStatus: "APPROVED" as const, countedIn: false },
      { basketReady: true, approvalStatus: "APPROVED" as const, countedIn: true },
    ];
    for (const state of states) {
      const view = describeDeliveryScreen(state);
      expect(`${view.title} ${view.body}`).not.toMatch(INTERNAL);
    }
  });
});
