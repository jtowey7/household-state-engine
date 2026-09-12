import { describe, expect, it, vi } from "vitest";

import { judgeCandidateBasket } from "../procurement/judge";
import type { CandidateBasket } from "../procurement/types";
import type { WeeklyCycleOptions, WeeklyCycleRun } from "./types";

const runWeeklyShadowCycle = vi.fn();
vi.mock("./cycle", () => ({ runWeeklyShadowCycle }));

const { runJudgedWeeklyShadowCycle } = await import("./judged");

function basket(): CandidateBasket {
  return {
    basketId: "BASKET-1", planId: "PLAN-1", snapshotId: "SNAP-1", replayId: "REPLAY-1", replayTimestamp: "2026-08-16T08:00:00.000Z", retailer: "Synthetic Tesco",
    lines: [{ itemKey: "milk", sku: "MILK-1", productName: "Milk 2L", retailer: "Synthetic Tesco", requiredQuantity: 2, unit: "L", packSize: 2, packUnit: "L", packCount: 1, orderedQuantity: 2, lineCost: 1.8, sourceEventIds: ["E1"], requirementIds: ["R1"], requirementCount: 1 }],
    exceptions: [], totalCost: 1.8, coverage: { demandItemKeys: ["milk"], sourcedItemKeys: ["milk"], unsourcedItemKeys: [], complete: true }, complete: true, readyForReview: true, readyForApproval: true, dispatched: false, requiresHumanApproval: true,
  };
}

const baseRun = {
  cycleId: "CYCLE-1", scope: { mode: "SYNTHETIC", datasetId: "synthetic", windowStart: "2026-08-16", windowEnd: "2026-08-16" }, asOf: "2026-08-16T08:00:00.000Z", stages: [], source: null, projection: null, appendProposals: [], deliveryTransitions: [], mealProposals: null, exceptionProposals: null, feedbackGate: null, snapshot: null, handoff: null, plan: null, basket: basket(), approval: { required: true, granted: false, readyForReview: true, reason: "Synthetic" }, isolatedItemKeys: [], mutatedHouseholdState: false, appendedEvents: false, dispatched: false, status: "COMPLETED",
} satisfies WeeklyCycleRun;

describe("runJudgedWeeklyShadowCycle", () => {
  it("adds a deterministic basket verdict without changing the shadow-cycle safety contract", async () => {
    runWeeklyShadowCycle.mockResolvedValueOnce(baseRun);
    const result = await runJudgedWeeklyShadowCycle({} as WeeklyCycleOptions);
    expect(result.basketJudge).toEqual(judgeCandidateBasket(baseRun.basket));
    expect(result.basketJudge?.verdict).toBe("PASS");
    expect(result.basketJudge?.readyForApproval).toBe(true);
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(runWeeklyShadowCycle).toHaveBeenCalledTimes(1);
  });

  it("returns NEEDS_REVIEW for an incomplete sourced basket", async () => {
    runWeeklyShadowCycle.mockClear();
    runWeeklyShadowCycle.mockResolvedValueOnce({ ...baseRun, basket: { ...baseRun.basket, basketId: "BASKET-REVIEW", complete: false, readyForApproval: false, coverage: { ...baseRun.basket.coverage, demandItemKeys: ["milk", "eggs"], unsourcedItemKeys: ["eggs"], complete: false } } });
    const result = await runJudgedWeeklyShadowCycle({} as WeeklyCycleOptions);
    expect(result.basketJudge?.verdict).toBe("NEEDS_REVIEW");
    expect(result.basketJudge?.readyForApproval).toBe(false);
    expect(result.basketJudge?.reasons).toContain("Basket is incomplete: 1 demanded item(s) lack a verified product source.");
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("returns REFUSE for a basket with missing requirement provenance", async () => {
    runWeeklyShadowCycle.mockClear();
    runWeeklyShadowCycle.mockResolvedValueOnce({ ...baseRun, basket: { ...baseRun.basket, basketId: "BASKET-REFUSE", lines: [{ ...baseRun.basket.lines[0], sourceEventIds: [], requirementIds: [], requirementCount: 0 }] } });
    const result = await runJudgedWeeklyShadowCycle({} as WeeklyCycleOptions);
    expect(result.basketJudge?.verdict).toBe("REFUSE");
    expect(result.basketJudge?.readyForApproval).toBe(false);
    expect(result.basketJudge?.reasons).toContain('Line "milk" has missing or blank requirement provenance.');
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("does not fabricate a judge result when the cycle produced no basket", async () => {
    runWeeklyShadowCycle.mockClear();
    runWeeklyShadowCycle.mockResolvedValueOnce({ ...baseRun, basket: null, status: "REFUSED" });
    const result = await runJudgedWeeklyShadowCycle({} as WeeklyCycleOptions);
    expect(result.basketJudge).toBeNull();
    expect(runWeeklyShadowCycle).toHaveBeenCalledTimes(1);
  });
});
