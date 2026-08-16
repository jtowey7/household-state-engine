import { describe, expect, it } from "vitest";
import { runSafetyBoundaryProof } from "./proof";
import { safetyProofNow, safetyProofRows, safetyProofTargets } from "./fixtures";

const OPTS = {
  rows: safetyProofRows,
  targets: safetyProofTargets,
  now: safetyProofNow,
  qualifiedItemKey: "milk-whole",
  exactItemKey: "oats-rolled",
  testEventId: "PROOF-EVT-TEST-1",
};

describe("adapter → replay → QUANTITY REQUIREMENTS safety boundary", () => {
  const run = runSafetyBoundaryProof(OPTS);

  it("all declared boundary checks pass", () => {
    expect(run.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
    expect(run.passed).toBe(true);
    expect(run.dispatched).toBe(false);
  });

  it("Production rows map to canonical events with no structural failures", () => {
    expect(run.mappingFailures).toEqual([]);
    expect(run.events.map((e) => e.eventId)).toEqual([
      "PROOF-EVT-1",
      "PROOF-EVT-2",
      "PROOF-EVT-3",
      "PROOF-EVT-TEST-1",
    ]);
    const oats = run.snapshot.items.find((i) => i.itemKey === "oats-rolled");
    expect(oats?.quantity).toBe(600);
    expect(oats?.unit).toBe("g");
  });

  it("Record class = Test has zero effect on state, handoff and requirements", () => {
    expect(run.snapshot.ignoredEventIds).toContain("PROOF-EVT-TEST-1");
    expect(run.snapshot.contributingEventIds).not.toContain("PROOF-EVT-TEST-1");
    const oats = run.snapshot.items.find((i) => i.itemKey === "oats-rolled");
    expect(oats?.contributingEventIds).toEqual(["PROOF-EVT-1", "PROOF-EVT-2"]);
    expect(
      run.plan.requirements.flatMap((r) => r.sourceEventIds),
    ).not.toContain("PROOF-EVT-TEST-1");
  });

  it("qualified evidence blocks only the affected item", () => {
    const milk = run.snapshot.items.find((i) => i.itemKey === "milk-whole");
    expect(milk?.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
    expect(milk?.blocked).toBe(true);
    expect(run.snapshot.blockedItemKeys).toEqual(["milk-whole"]);
    expect(run.handoff.items.map((i) => i.itemKey)).not.toContain("milk-whole");
    expect(run.plan.requirements.map((r) => r.itemKey)).not.toContain("milk-whole");
    expect(
      run.plan.rejections.filter((r) => r.code === "ITEM_ISOLATED").map((r) => r.itemKey),
    ).toEqual(["milk-whole"]);
  });

  it("unrelated exact items remain eligible, including a zero on-hand target", () => {
    expect(run.plan.executed).toBe(true);
    expect(run.plan.eligibleForProcurement).toBe(true);
    expect(run.plan.requirements.map((r) => r.itemKey)).toEqual([
      "eggs-large",
      "oats-rolled",
    ]);
    const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    expect(oats.onHandQuantity).toBe(600);
    expect(oats.requiredQuantity).toBe(1400);
    expect(oats.packCount).toBe(3);
    const eggs = run.plan.requirements.find((r) => r.itemKey === "eggs-large")!;
    expect(eggs.onHandQuantity).toBe(0);
    expect(eggs.sourceEventIds).toEqual([]);
  });

  it("preserves replayId / snapshotId / source event IDs end to end", () => {
    expect(run.handoff.replayId).toBe(run.snapshot.replayId);
    expect(run.handoff.snapshotId).toBe(run.snapshot.snapshotId);
    expect(run.plan.replayId).toBe(run.snapshot.replayId);
    expect(run.plan.snapshotId).toBe(run.snapshot.snapshotId);
    expect(run.plan.replayTimestamp).toBe(run.snapshot.replayTimestamp);
    const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    expect(oats.sourceEventIds).toEqual(["PROOF-EVT-1", "PROOF-EVT-2"]);
  });

  it("is deterministic across repeated runs", () => {
    const again = runSafetyBoundaryProof(OPTS);
    expect(again).toEqual(run);
    expect(again.plan.planId).toBe(run.plan.planId);
  });

  it("never writes and never dispatches", () => {
    expect(run.readOnly).toBe(true);
    expect(run.dispatched).toBe(false);
  });
});
