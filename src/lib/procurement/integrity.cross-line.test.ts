import { describe, expect, it } from "vitest";

import { validateBasketIntegrity } from "./integrity";
import type { CandidateBasket } from "./types";

describe("Basket Phase 4 cross-line requirement provenance", () => {
  it("rejects the same requirement ID attributed to different basket lines", () => {
    const basket = {
      basketId: "BASKET-CROSS-LINE-REQUIREMENT-1",
      planId: "PLAN-1",
      snapshotId: "SNAP-1",
      replayId: "REPLAY-1",
      replayTimestamp: "2026-08-24T00:00:00.000Z",
      retailer: "Synthetic Tesco",
      lines: [
        {
          itemKey: "milk",
          sku: "MILK-1",
          productName: "Milk 2L",
          retailer: "Synthetic Tesco",
          requiredQuantity: 2,
          unit: "L",
          packSize: 2,
          packUnit: "L",
          packCount: 1,
          orderedQuantity: 2,
          lineCost: 1.8,
          sourceEventIds: ["EVENT-MILK"],
          requirementIds: ["REQ-1"],
          requirementCount: 1,
        },
        {
          itemKey: "eggs",
          sku: "EGGS-1",
          productName: "Eggs 12 pack",
          retailer: "Synthetic Tesco",
          requiredQuantity: 12,
          unit: "each",
          packSize: 12,
          packUnit: "each",
          packCount: 1,
          orderedQuantity: 12,
          lineCost: 3.2,
          sourceEventIds: ["EVENT-EGGS"],
          requirementIds: ["REQ-1"],
          requirementCount: 1,
        },
      ],
      exceptions: [],
      totalCost: 5,
      coverage: {
        demandItemKeys: ["milk", "eggs"],
        sourcedItemKeys: ["milk", "eggs"],
        unsourcedItemKeys: [],
        complete: true,
      },
      complete: true,
      readyForReview: true,
      readyForApproval: true,
      dispatched: false,
      requiresHumanApproval: true,
    } as unknown as CandidateBasket;

    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "DUPLICATE_REQUIREMENT_ID_ACROSS_LINES",
      itemKey: "eggs",
      detail: 'Requirement ID "REQ-1" is attributed to both "milk" and "eggs".',
    });
  });
});
