import { describe, expect, it } from "vitest";

import { validateBasketEconomics } from "./economic";
import type { CandidateBasket } from "./types";

function basket(totalCost: number): CandidateBasket {
  const line = {
    itemKey: "oats-rolled",
    sku: "OATS-500",
    productName: "Rolled oats 500g",
    retailer: "synthetic-grocer",
    requiredQuantity: 500,
    unit: "g",
    packSize: 500,
    packUnit: "g",
    packCount: 1,
    orderedQuantity: 500,
    lineCost: totalCost,
    sourceEventIds: ["EVT-1"],
    requirementIds: ["REQ-1"],
    requirementCount: 1,
  };

  return {
    basketId: `BASKET-${totalCost}`,
    planId: "PLAN-1",
    snapshotId: "SNAP-1",
    replayId: "REPLAY-1",
    replayTimestamp: "2026-08-20T00:00:00.000Z",
    retailer: "synthetic-grocer",
    lines: [line],
    exceptions: [],
    totalCost,
    coverage: {
      demandItemKeys: ["oats-rolled"],
      sourcedItemKeys: ["oats-rolled"],
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

describe("Phase 3 Basket economic validation", () => {
  it("passes a basket at or below the £150 target", () => {
    const result = validateBasketEconomics(basket(150));

    expect(result.status).toBe("WITHIN_TARGET");
    expect(result.varianceToTarget).toBe(0);
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("keeps a basket above target but within £175 normally acceptable spend reviewable", () => {
    const result = validateBasketEconomics(basket(165));

    expect(result.status).toBe("WITHIN_ACCEPTABLE");
    expect(result.varianceToTarget).toBe(15);
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.reasons[0]).toContain("£15.00 above the £150.00 target");
  });

  it("keeps the exact £175 acceptable boundary outside the approval requirement", () => {
    const result = validateBasketEconomics(basket(175));

    expect(result.status).toBe("WITHIN_ACCEPTABLE");
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.varianceToTarget).toBe(25);
  });

  it("flags spend above £175 without granting approval", () => {
    const result = validateBasketEconomics(basket(178));

    expect(result.status).toBe("ABOVE_ACCEPTABLE");
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.reasons[0]).toContain("above the £175.00 normally acceptable range");
  });

  it("keeps the exact £180 approval threshold non-approving", () => {
    const result = validateBasketEconomics(basket(180));

    expect(result.status).toBe("ABOVE_ACCEPTABLE");
    expect(result.requiresHumanApproval).toBe(false);
  });

  it("requires explicit human approval above the £180 threshold", () => {
    const result = validateBasketEconomics(basket(181));

    expect(result.status).toBe("ABOVE_APPROVAL_THRESHOLD");
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.reasons[0]).toContain("exceeds the explicit £180.00 human-approval threshold by £1.00");
  });

  it("rejects inconsistent basket totals rather than validating a false economic result", () => {
    const candidate = basket(181);
    candidate.lines[0]!.lineCost = 180;

    expect(() => validateBasketEconomics(candidate)).toThrow("BASKET_TOTAL_MISMATCH");
  });

  it("rejects negative line costs rather than allowing them to offset positive spend", () => {
    const candidate = basket(150);
    candidate.lines.push({
      ...candidate.lines[0]!,
      itemKey: "eggs",
      sku: "EGGS-12",
      lineCost: -50,
    });
    candidate.totalCost = 150;

    expect(() => validateBasketEconomics(candidate)).toThrow("INVALID_LINE_COST");
  });

  it("rejects a half-penny basket-total mismatch rather than treating it as floating-point noise", () => {
    const candidate = basket(100.005);
    candidate.lines[0]!.lineCost = 100;

    expect(() => validateBasketEconomics(candidate)).toThrow("BASKET_TOTAL_MISMATCH");
  });

  it("allows explicit budget bands for future household policy changes", () => {
    const result = validateBasketEconomics(basket(130), {
      targetBudget: 120,
      acceptableBudget: 140,
      approvalThreshold: 150,
    });

    expect(result.status).toBe("WITHIN_ACCEPTABLE");
    expect(result.targetBudget).toBe(120);
    expect(result.acceptableBudget).toBe(140);
    expect(result.approvalThreshold).toBe(150);
    expect(result.varianceToTarget).toBe(10);
  });

  it("rejects invalid budget-band ordering", () => {
    expect(() =>
      validateBasketEconomics(basket(100), {
        targetBudget: 150,
        acceptableBudget: 140,
        approvalThreshold: 180,
      }),
    ).toThrow("INVALID_BUDGET_BANDS");
  });
});
