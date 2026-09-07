import { describe, expect, it } from "vitest";

import { replayEvents } from "../state-engine/engine";
import { baseFixture } from "../state-engine/fixtures";
import { aggregateCandidateBasket } from "../procurement/adapter";
import { shadowCatalogue } from "../procurement/fixtures";
import { adaptSnapshotToQuantityRun } from "./adapter";

const fixedNow = { now: () => "1970-01-01T00:00:00.000Z" };

describe("quantity plan partial-demand safety", () => {
  it("never marks a partially resolved demand set procurement-eligible", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [
        { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" },
        // Deliberately incompatible with the replayed milk unit. This drops one
        // demanded item while oats remains valid and would otherwise produce a
        // superficially usable partial plan.
        { itemKey: "milk-whole", targetQuantity: 3, unit: "kg" },
      ],
    });

    expect(plan.executed).toBe(true);
    expect(plan.requirements.map((r) => r.itemKey)).toEqual(["oats-rolled"]);
    expect(plan.rejections).toEqual([
      {
        code: "UNIT_MISMATCH",
        itemKey: "milk-whole",
        detail: 'Replay unit "L" does not match demand target unit "kg".',
        fatal: false,
      },
    ]);
    expect(plan.eligibleForProcurement).toBe(false);

    const basket = aggregateCandidateBasket(plan, {
      catalogue: shadowCatalogue,
      retailer: "synthetic-grocer",
    });
    expect(basket.lines).toEqual([]);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.exceptions[0]?.code).toBe("PLAN_NOT_ELIGIBLE");
  });

  it("still allows a valid demand set with inventory-only replay rows", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" }],
    });

    expect(plan.eligibleForProcurement).toBe(true);
    expect(plan.requirements.map((r) => r.itemKey)).toEqual(["oats-rolled"]);
    expect(plan.rejections.every((r) => r.code === "NO_DEMAND_TARGET")).toBe(true);
  });
});
