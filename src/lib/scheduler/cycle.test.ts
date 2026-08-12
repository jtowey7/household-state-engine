import { describe, expect, it } from "vitest";

import { blockedControlPlane, cleanControlPlane, runSchedulerCycle, selectWork } from ".";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";
import { createMemoryProductionPort } from "../production-adapter";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { shadowCatalogue } from "../procurement";
import { consumptionFixture } from "../consumption/fixtures";

const work = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
  catalogue: shadowCatalogue,
};

const wakeAt = "2026-08-03T20:20:00.000Z";
const opts = { controlPlane: cleanControlPlane, wakeAt, work };

describe("control-plane work selection", () => {
  it("picks the highest-priority unblocked directive rather than a hard-coded task", () => {
    const selection = selectWork(cleanControlPlane);
    expect(selection.selected).toBe(true);
    if (selection.selected) expect(selection.directive.directiveId).toBe("DIR-010");
  });

  it("excludes Record class = Test control rows entirely", () => {
    const selection = selectWork(cleanControlPlane);
    expect(selection.consideredIds).not.toContain("DIR-001");
  });

  it("advances to the dependent directive once its dependency is done", () => {
    const selection = selectWork(cleanControlPlane, { completedDirectiveIds: ["DIR-010"] });
    expect(selection.selected && selection.directive.directiveId).toBe("DIR-020");
  });

  it("refuses when every open directive is blocked or dependency-gated", () => {
    const selection = selectWork(blockedControlPlane);
    expect(selection.selected).toBe(false);
    if (!selection.selected) {
      expect(selection.refusal.code).toBe("ALL_BLOCKED");
      expect(selection.blocked.map((b) => b.directiveId)).toEqual(["DIR-010", "DIR-020"]);
    }
  });
});

describe("stateless scheduler cycle — clean executable path", () => {
  it("runs one complete cycle and emits structured evidence", async () => {
    const { evidence, run } = await runSchedulerCycle(opts);
    expect(evidence.outcome).toBe("EXECUTED");
    expect(evidence.directiveSelected).toBe("DIR-010");
    expect(evidence.checks.every((c) => c.passed)).toBe(true);
    expect(run?.plan?.requirements.length ?? 0).toBeGreaterThan(0);
    expect(evidence.workPerformed).toContain("candidate basket");
  });

  it("never mutates household state, appends events or dispatches", async () => {
    const { evidence, run } = await runSchedulerCycle(opts);
    expect(evidence.mutatedHouseholdState).toBe(false);
    expect(evidence.appendedEvents).toBe(false);
    expect(evidence.dispatched).toBe(false);
    expect(run?.basket?.dispatched).toBe(false);
    expect(run?.approval.granted).toBe(false);
  });

  it("persists a replayable handoff pointing at the next directive", async () => {
    const { evidence } = await runSchedulerCycle(opts);
    expect(evidence.nextHandoff.completedDirectiveIds).toContain("DIR-010");
    expect(evidence.nextHandoff.nextDirectiveId).toBe("DIR-020");
    expect(evidence.nextHandoff.snapshotId).toBeTruthy();
    expect(evidence.nextHandoff.replayId).toBeTruthy();
    expect(evidence.nextHandoff.requiresHumanApproval).toBe(true);
  });

  it("is deterministic: replaying the same wake-up reproduces the same evidence", async () => {
    const a = await runSchedulerCycle(opts);
    const b = await runSchedulerCycle(opts);
    expect(b.evidence).toEqual(a.evidence);
  });

  it("carries the handoff forward statelessly into the next wake-up", async () => {
    const first = await runSchedulerCycle(opts);
    const second = await runSchedulerCycle({
      ...opts,
      wakeAt: "2026-08-03T20:40:00.000Z",
      completedDirectiveIds: first.evidence.nextHandoff.completedDirectiveIds,
    });
    expect(second.evidence.directiveSelected).toBe("DIR-020");
    expect(second.evidence.cycleId).not.toBe(first.evidence.cycleId);
  });

  it("keeps append proposals as proposals bound to immutable Event IDs", async () => {
    const { evidence, run } = await runSchedulerCycle(opts);
    expect(run?.appendProposals.every((p) => p.requiresHumanAuthorization)).toBe(true);
    expect(new Set(evidence.proposalIds).size).toBe(evidence.proposalIds.length);
  });
});

describe("stateless scheduler cycle — blocked paths", () => {
  it("performs no work when the control plane blocks everything", async () => {
    const { evidence, run } = await runSchedulerCycle({
      ...opts,
      controlPlane: blockedControlPlane,
    });
    expect(evidence.outcome).toBe("BLOCKED");
    expect(evidence.directiveSelected).toBeNull();
    expect(run).toBeNull();
    expect(evidence.blockedActions.length).toBeGreaterThan(0);
    expect(evidence.nextHandoff.snapshotId).toBeNull();
  });

  it("blocks the cycle when the source read is refused", async () => {
    const { evidence } = await runSchedulerCycle({
      ...opts,
      work: {
        ...work,
        port: createMemoryProductionPort({
          openingEvents: consumptionFixture.openingEvents ?? [],
          targets: shadowTargets,
          failWith: "connector offline",
        }),
      },
    });
    expect(evidence.outcome).toBe("BLOCKED");
    expect(evidence.checks.some((c) => c.label === "Replay completed" && !c.passed)).toBe(true);
    expect(evidence.nextHandoff.completedDirectiveIds).not.toContain("DIR-010");
  });

  it("isolates a reused Event ID with a conflicting payload instead of applying it", async () => {
    const opening = consumptionFixture.openingEvents ?? [];
    const conflict = { ...opening[0]!, eventId: "OPEN-DUP", payload: { quantity: 1, unit: "g" } };
    const conflictTwin = { ...conflict, payload: { quantity: 2, unit: "g" } };
    const { evidence, run } = await runSchedulerCycle({
      ...opts,
      work: {
        ...work,
        port: createMemoryProductionPort({
          openingEvents: [...opening, conflict, conflictTwin],
          targets: shadowTargets,
        }),
      },
    });
    expect(run?.source?.quarantinedItemKeys).toContain(conflict.itemKey);
    expect(run?.plan?.requirements.map((r) => r.itemKey)).not.toContain(conflict.itemKey);
    expect(evidence.blockedActions.some((b) => b.action.includes(conflict.itemKey))).toBe(true);
  });

  it("refuses a directive kind with no proven executable seam", async () => {
    const { evidence } = await runSchedulerCycle({
      ...opts,
      completedDirectiveIds: ["DIR-010", "DIR-020"],
    });
    expect(evidence.directiveSelected).toBe("DIR-030");
    expect(evidence.outcome).toBe("REFUSED");
    expect(evidence.proposalIds).toEqual([]);
  });

  it("refuses to auto-execute an EXECUTE-policy directive", async () => {
    const cp = {
      ...cleanControlPlane,
      directives: [
        {
          directiveId: "DIR-099",
          title: "Place the weekly order",
          kind: "WEEKLY_SHADOW_CYCLE" as const,
          priority: "P0" as const,
          status: "READY" as const,
          actionPolicy: "EXECUTE" as const,
        },
      ],
    };
    const { evidence } = await runSchedulerCycle({ ...opts, controlPlane: cp });
    expect(evidence.blockedActions.some((b) => b.reason.includes("ACTION POLICY"))).toBe(true);
    expect(evidence.dispatched).toBe(false);
  });
});
