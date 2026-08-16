import { describe, expect, it, vi } from "vitest";
import { judgeCandidateBasket } from "../procurement/judge";
import type { CandidateBasket } from "../procurement/types";
import type { WeeklyCycleRun } from "../weekly-cycle/types";

const runShadowHouseholdCycle = vi.fn();
vi.mock("./shadow-run", () => ({ runShadowHouseholdCycle }));

const { runJudgedShadowHouseholdCycle } = await import("./judged");

function basket(): CandidateBasket {
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
  };
}

const baseRun = {
  cycleId: "CYCLE-1",
  scope: { mode: "SYNTHETIC", datasetId: "synthetic", windowStart: "2026-08-16", windowEnd: "2026-08-16" },
  asOf: "2026-08-16T08:00:00.000Z",
  stages: [],
  source: null,
  projection: null,
  snapshot: null,
  handoff: null,
  plan: null,
  appendProposals: [],
  mealProposals: null,
  exceptionProposals: null,
  feedbackGate: null,
  basket: basket(),
  approval: { required: true, granted: false, readyForReview: true, reason: "Synthetic" },
  isolatedItemKeys: [],
  mutatedHouseholdState: false,
  appendedEvents: false,
  dispatched: false,
  status: "COMPLETED",
} satisfies WeeklyCycleRun;

describe("runJudgedShadowHouseholdCycle", () => {
  it("judges the basket produced by the real household shadow adapter without mutation", async () => {
    runShadowHouseholdCycle.mockResolvedValueOnce(baseRun);

    const result = await runJudgedShadowHouseholdCycle();

    expect(result.basketJudge).toEqual(judgeCandidateBasket(baseRun.basket));
    expect(result.basketJudge?.verdict).toBe("PASS");
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(runShadowHouseholdCycle).toHaveBeenCalledTimes(1);
  });

  it("returns no judge result when the shadow adapter produces no basket", async () => {
    runShadowHouseholdCycle.mockResolvedValueOnce({ ...baseRun, basket: null, status: "REFUSED" });

    const result = await runJudgedShadowHouseholdCycle();

    expect(result.basketJudge).toBeNull();
    expect(runShadowHouseholdCycle).toHaveBeenCalledTimes(1);
  });
});
