import { describe, expect, it } from "vitest";

import { validateBasketIntegrity } from "./integrity";
import type { CandidateBasket } from "./types";

function validBasket(): CandidateBasket {
  return {
    basketId: "BASKET-PHASE4-REDTEAM-1",
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
        requirementIds: ["REQ-MILK"],
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
        requirementIds: ["REQ-EGGS"],
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
  };
}

describe("Basket Phase 4 cross-line provenance and identity", () => {
  it("rejects source event provenance reused across different basket lines", () => {
    const basket = validBasket();
    basket.lines[1]!.sourceEventIds = ["EVENT-MILK"];

    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "DUPLICATE_SOURCE_EVENT_ID_ACROSS_LINES",
      itemKey: "eggs",
      detail: 'Source event ID "EVENT-MILK" is attributed to both "milk" and "eggs".',
    });
  });

  it("rejects requirement provenance reused across different basket lines", () => {
    const basket = validBasket();
    basket.lines[1]!.requirementIds = ["REQ-MILK"];

    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "DUPLICATE_REQUIREMENT_ID_ACROSS_LINES",
      itemKey: "eggs",
      detail: 'Requirement ID "REQ-MILK" is attributed to both "milk" and "eggs".',
    });
  });

  it("rejects blank item keys even when coverage and economics otherwise reconcile", () => {
    const basket = validBasket();
    basket.lines[0]!.itemKey = "  ";
    basket.coverage.demandItemKeys[0] = "  ";
    basket.coverage.sourcedItemKeys[0] = "  ";

    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "INVALID_ITEM_KEY",
      itemKey: "  ",
      detail: "Basket demand coverage contains a blank item key.",
    });
    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "INVALID_ITEM_KEY",
      itemKey: "  ",
      detail: "Basket line contains a blank item key.",
    });
  });
});
