import { describe, expect, it } from "vitest";

import { validateBasketIntegrity } from "./integrity";
import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";

function basketWithMissingSourcedLine(): CandidateBasket {
  return {
    basketId: "BASKET-COVERAGE-LINE-1",
    planId: "PLAN-1",
    snapshotId: "SNAP-1",
    replayId: "REPLAY-1",
    replayTimestamp: "2026-08-27T12:00:00.000Z",
    retailer: "synthetic-grocer",
    lines: [
      {
        itemKey: "milk",
        sku: "MILK-1",
        productName: "Milk 2L",
        retailer: "synthetic-grocer",
        requiredQuantity: 2,
        unit: "L",
        packSize: 2,
        packUnit: "L",
        packCount: 1,
        orderedQuantity: 2,
        lineCost: 1.8,
        sourceEventIds: ["EVENT-MILK"],
        requirementIds: ["REQ-MILK"],
        requirementCount: 1,
      },
    ],
    exceptions: [],
    totalCost: 1.8,
    coverage: {
      demandItemKeys: ["milk", "bread"],
      sourcedItemKeys: ["milk", "bread"],
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
  };
}

describe("basket judge: sourced coverage must have a line", () => {
  it("refuses a complete basket that claims a sourced item without a corresponding basket line", () => {
    const basket = basketWithMissingSourcedLine();

    expect(validateBasketIntegrity(basket)).not.toContainEqual(
      expect.objectContaining({ code: "SOURCED_COVERAGE_WITHOUT_LINE" }),
    );
    expect(judgeCandidateBasket(basket).verdict).toBe("REFUSE");
    expect(judgeCandidateBasket(basket).readyForApproval).toBe(false);
  });
});
