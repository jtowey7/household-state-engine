import { describe, expect, it } from "vitest";
import { runJudgedShadowHouseholdCycle, shadowQuantityFor, SALMON } from "./index";

describe("family-alpha shadow household full acceptance", () => {
  it("runs the complete isolated chain through the public module surface", async () => {
    const run = await runJudgedShadowHouseholdCycle();

    expect(run.scope.mode).toBe("SYNTHETIC");
    expect(run.source?.writable).toBe(false);
    expect(run.snapshot?.snapshotId).toBeTruthy();
    expect(run.plan?.executed).toBe(true);
    expect(run.plan?.requirements.some((r) => r.itemKey === SALMON)).toBe(true);
    expect(run.basket).not.toBeNull();
    expect(run.basketJudge?.basketId).toBe(run.basket?.basketId);
    // The declared family fixture deliberately contains an uncertain banana
    // quantity. The full-chain proof therefore must surface review rather than
    // falsely claim the basket is approval-ready.
    expect(run.basketJudge?.verdict).toBe("NEEDS_REVIEW");
    expect(run.basketJudge?.readyForApproval).toBe(false);
    expect(run.approval.required).toBe(true);
    expect(run.approval.granted).toBe(false);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(shadowQuantityFor(run, SALMON)?.quantity).toBe(0);
  });

  it("keeps the complete chain deterministic across repeated runs", async () => {
    const a = await runJudgedShadowHouseholdCycle();
    const b = await runJudgedShadowHouseholdCycle();

    expect(b.cycleId).toBe(a.cycleId);
    expect(b.snapshot?.snapshotId).toBe(a.snapshot?.snapshotId);
    expect(b.plan?.planId).toBe(a.plan?.planId);
    expect(b.basket?.basketId).toBe(a.basket?.basketId);
    expect(b.basketJudge?.judgeId).toBe(a.basketJudge?.judgeId);
  });
});
