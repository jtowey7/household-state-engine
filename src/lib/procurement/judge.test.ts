import { describe, expect, it } from "vitest";

import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";

function basket(overrides: Partial<CandidateBasket> = {}): CandidateBasket {
  return {
    basketId: "BASKET-1",
    planId: "PLAN-1",
    snapshotId: "SNAP-1",
    replayId: "REPLAY-1",
    replayTimestamp: "2026-08-16T08:00:00.000Z",
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
        sourceEventIds: ["E1"],
        requirementIds: ["R1"],
        requirementCount: 1,
      },
    ],
    exceptions: [],
    totalCost: 1.8,
    coverage: {
      demandItemKeys: ["milk"],
      sourcedItemKeys: ["milk"],
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
    ...overrides,
  };
}

describe("judgeCandidateBasket", () => {
  it("passes a complete, sourced, provenance-preserving basket", () => {
    const result = judgeCandidateBasket(basket());
    expect(result.verdict).toBe("PASS");
    expect(result.readyForApproval).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.tradeoffs.some((t) => t.includes("£1.80"))).toBe(true);
  });

  it("requires review for incomplete coverage instead of treating a partial basket as complete", () => {
    const result = judgeCandidateBasket(
      basket({
        complete: false,
        readyForApproval: false,
        coverage: {
          demandItemKeys: ["milk", "eggs"],
          sourcedItemKeys: ["milk"],
          unsourcedItemKeys: ["eggs"],
          complete: false,
        },
        exceptions: [
          {
            code: "NO_CATALOGUE_MATCH",
            itemKey: "eggs",
            detail: "No verified source",
            fatal: false,
          },
        ],
      }),
    );
    expect(result.verdict).toBe("NEEDS_REVIEW");
    expect(result.readyForApproval).toBe(false);
    expect(result.tradeoffs.join(" ")).toContain("eggs");
  });

  it("refuses a basket line with missing provenance or invalid arithmetic", () => {
    const result = judgeCandidateBasket(
      basket({
        lines: [
          {
            ...basket().lines[0]!,
            sourceEventIds: [],
            packCount: 0,
          },
        ],
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses non-finite line economics instead of allowing NaN to bypass comparisons", () => {
    const result = judgeCandidateBasket(
      basket({
        lines: [
          {
            ...basket().lines[0]!,
            lineCost: Number.NaN,
          },
        ],
        totalCost: Number.NaN,
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses a basket whose total does not reconcile to its line costs", () => {
    const result = judgeCandidateBasket(basket({ totalCost: 99.99 }));
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
    expect(result.reasons).toContain("Basket total does not reconcile to its line costs.");
  });

  it("refuses negative required quantity even when ordered quantity and cost look valid", () => {
    const result = judgeCandidateBasket(
      basket({
        lines: [{ ...basket().lines[0]!, requiredQuantity: -2 }],
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses non-positive pack size and unit-inconsistent pack arithmetic", () => {
    const result = judgeCandidateBasket(
      basket({
        lines: [{ ...basket().lines[0]!, packSize: 0, packUnit: "kg" }],
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses ordered quantity below the required quantity", () => {
    const result = judgeCandidateBasket(
      basket({
        lines: [{ ...basket().lines[0]!, orderedQuantity: 1 }],
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses a complete basket when coverage contains an extra item", () => {
    const result = judgeCandidateBasket(
      basket({
        coverage: {
          demandItemKeys: ["milk"],
          sourcedItemKeys: ["milk", "eggs"],
          unsourcedItemKeys: [],
          complete: true,
        },
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses a basket when completion flags disagree", () => {
    const result = judgeCandidateBasket(
      basket({
        complete: true,
        coverage: {
          demandItemKeys: ["milk"],
          sourcedItemKeys: ["milk"],
          unsourcedItemKeys: [],
          complete: false,
        },
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses a basket line that is absent from sourced coverage", () => {
    const result = judgeCandidateBasket(
      basket({
        coverage: {
          demandItemKeys: ["milk", "eggs"],
          sourcedItemKeys: ["eggs"],
          unsourcedItemKeys: ["milk"],
          complete: false,
        },
        complete: false,
        readyForApproval: false,
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("refuses duplicate item lines rather than silently double-counting coverage", () => {
    const first = basket().lines[0]!;
    const result = judgeCandidateBasket(
      basket({
        lines: [first, { ...first, sku: "MILK-2", lineCost: 2.1 }],
        totalCost: 3.9,
      }),
    );
    expect(result.verdict).toBe("REFUSE");
    expect(result.readyForApproval).toBe(false);
  });

  it("is deterministic for identical basket input", () => {
    const a = judgeCandidateBasket(basket());
    const b = judgeCandidateBasket(basket());
    expect(b).toEqual(a);
  });
});
