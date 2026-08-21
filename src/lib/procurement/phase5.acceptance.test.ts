import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from "./adapter";
import { shadowCatalogue } from "./fixtures";
import { judgeCandidateBasket } from "./judge";
import type { QuantityRunPlan } from "../quantity-adapter/types";

function plan(overrides: Partial<QuantityRunPlan> = {}): QuantityRunPlan {
  return {
    replayId: "REPLAY-PHASE5",
    snapshotId: "SNAPSHOT-PHASE5",
    replayTimestamp: "2026-08-21T22:00:00.000Z",
    reconciliationStatus: "RECONCILED",
    planId: "PLAN-PHASE5",
    eligibleForProcurement: true,
    executed: true,
    requirements: [
      {
        requirementId: "REQ-OATS",
        itemKey: "oats-rolled",
        requiredQuantity: 750,
        unit: "g",
        onHandQuantity: 0,
        targetQuantity: 750,
        sourceEventIds: ["EVENT-OATS"],
        packSize: 500,
        packCount: 2,
        packRoundedQuantity: 1000,
      },
      {
        requirementId: "REQ-EGGS",
        itemKey: "eggs-large",
        requiredQuantity: 6,
        unit: "count",
        onHandQuantity: 0,
        targetQuantity: 6,
        sourceEventIds: ["EVENT-EGGS"],
        packSize: 6,
        packCount: 1,
        packRoundedQuantity: 6,
      },
    ],
    rejections: [],
    blockedItemKeys: [],
    ...overrides,
  };
}

describe("Basket Phase 5 acceptance", () => {
  it("judges a complete sourced shadow basket as PASS and keeps approval human-gated", () => {
    const basket = aggregateCandidateBasket(plan(), {
      catalogue: shadowCatalogue,
      retailer: "synthetic-grocer",
    });

    expect(basket.complete).toBe(true);
    expect(basket.readyForApproval).toBe(true);
    expect(basket.dispatched).toBe(false);
    expect(basket.requiresHumanApproval).toBe(true);

    const result = judgeCandidateBasket(basket);
    expect(result.verdict).toBe("PASS");
    expect(result.readyForApproval).toBe(true);
  });

  it("keeps an incomplete shadow basket at NEEDS_REVIEW rather than treating partial coverage as approval-ready", () => {
    const partialPlan = plan({
      requirements: [
        plan().requirements[0]!,
        {
          ...plan().requirements[1]!,
          itemKey: "unlisted-eggs",
        },
      ],
    });

    const basket = aggregateCandidateBasket(partialPlan, {
      catalogue: shadowCatalogue,
      retailer: "synthetic-grocer",
    });
    const result = judgeCandidateBasket(basket);

    expect(basket.complete).toBe(false);
    expect(result.verdict).toBe("NEEDS_REVIEW");
    expect(result.readyForApproval).toBe(false);
    expect(result.reasons.join(" ")).toContain("sourcing/procurement exception");
  });

  it("refuses a structurally invalid basket before the approval boundary", () => {
    const basket = aggregateCandidateBasket(plan(), {
      catalogue: shadowCatalogue,
      retailer: "synthetic-grocer",
    });
    const invalid = {
      ...basket,
      lines: [
        {
          ...basket.lines[0]!,
          sourceEventIds: [],
          packCount: 0,
        },
      ],
    };

    const result = judgeCandidateBasket(invalid);
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("is deterministic across repeated identical shadow evaluation", () => {
    const first = judgeCandidateBasket(
      aggregateCandidateBasket(plan(), {
        catalogue: shadowCatalogue,
        retailer: "synthetic-grocer",
      }),
    );
    const second = judgeCandidateBasket(
      aggregateCandidateBasket(plan(), {
        catalogue: shadowCatalogue,
        retailer: "synthetic-grocer",
      }),
    );

    expect(second).toEqual(first);
  });
});
