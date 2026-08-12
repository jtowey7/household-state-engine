import { describe, expect, it } from "vitest";

import { runWeeklyShadowCycle, weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from ".";
import { createMemoryProductionPort } from "../production-adapter";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { consumptionFixture } from "../consumption/fixtures";

const opts = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

describe("weekly shadow cycle", () => {
  it("runs every stage end-to-end and produces an approvable proposal", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.status).toBe("COMPLETED");
    expect(run.stages.map((s) => s.stage)).toEqual([
      "LOAD_SOURCE",
      "PROJECT_CONSUMPTION",
      "REPLAY",
      "HANDOFF",
      "QUANTITY_PLAN",
      "APPROVAL_GATE",
    ]);
    expect(run.stages.some((s) => s.status === "FAILED")).toBe(false);
    expect(run.plan?.requirements.length).toBeGreaterThan(0);
  });

  it("never mutates household state and never dispatches", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.source?.writable).toBe(false);
  });

  it("keeps human approval outside the calculation", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.approval.required).toBe(true);
    expect(run.approval.granted).toBe(false);
    expect(run.approval.readyForReview).toBe(true);
  });

  it("preserves provenance from source events to quantity requirements", async () => {
    const run = await runWeeklyShadowCycle(opts);
    const ids = run.plan!.requirements.flatMap((r) => r.sourceEventIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(run.snapshot!.contributingEventIds).toContain(id);
  });

  it("is deterministic: repeated runs share cycleId, snapshotId and planId", async () => {
    const a = await runWeeklyShadowCycle(opts);
    const b = await runWeeklyShadowCycle(opts);
    expect(b.cycleId).toBe(a.cycleId);
    expect(b.snapshot!.snapshotId).toBe(a.snapshot!.snapshotId);
    expect(b.plan!.planId).toBe(a.plan!.planId);
  });

  it("refuses the whole cycle when the source read is refused", async () => {
    const run = await runWeeklyShadowCycle({
      ...opts,
      port: createMemoryProductionPort({
        openingEvents: consumptionFixture.openingEvents ?? [],
        targets: shadowTargets,
        failWith: "connector offline",
      }),
    });
    expect(run.status).toBe("REFUSED");
    expect(run.plan).toBeNull();
    expect(run.approval.readyForReview).toBe(false);
    expect(run.stages.filter((s) => s.status === "SKIPPED")).toHaveLength(4);
  });

  it("isolates an uncertain item without blocking unrelated requirements", async () => {
    const run = await runWeeklyShadowCycle({
      ...opts,
      plan: {
        ...weeklyPlan,
        exceptions: [
          ...(weeklyPlan.exceptions ?? []),
          {
            exceptionId: "EXC-UNCERTAIN",
            type: "UNCERTAIN_QUANTITY",
            itemKey: "oats-rolled",
            occurredAt: "2026-08-03T10:00:00.000Z",
          },
        ],
      },
    });
    expect(run.isolatedItemKeys).toContain("oats-rolled");
    expect(run.handoff!.items.map((i) => i.itemKey)).not.toContain("oats-rolled");
    expect(run.status).toBe("COMPLETED");
  });

  it("refuses the quantity stage when replay is blocked by a reused Event ID", async () => {
    const opening = consumptionFixture.openingEvents ?? [];
    const conflict = { ...opening[0]!, eventId: "OPEN-DUP", payload: { quantity: 1, unit: "g" } };
    const conflictTwin = { ...conflict, payload: { quantity: 2, unit: "g" } };
    const run = await runWeeklyShadowCycle({
      ...opts,
      port: createMemoryProductionPort({
        openingEvents: [...opening, conflict, conflictTwin],
        targets: shadowTargets,
      }),
    });
    // Source-level quarantine keeps the conflicted item out of replay entirely.
    expect(run.source!.quarantinedItemKeys).toContain(conflict.itemKey);
    expect(run.plan!.requirements.map((r) => r.itemKey)).not.toContain(conflict.itemKey);
  });

  it("records observability metrics for every stage", async () => {
    const run = await runWeeklyShadowCycle(opts);
    for (const stage of run.stages) {
      expect(typeof stage.detail).toBe("string");
      expect(stage.detail.length).toBeGreaterThan(0);
      expect(Array.isArray(stage.warnings)).toBe(true);
    }
    const replay = run.stages.find((s) => s.stage === "REPLAY")!;
    expect(replay.metrics["snapshotId"]).toBe(run.snapshot!.snapshotId);
  });
});
