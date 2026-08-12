import { describe, expect, it } from "vitest";

import {
  cleanControlPlane,
  runSchedulerCycle,
  sealHandoff,
  verifyHandoff,
  type HandoffRecord,
} from ".";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";
import { shadowCatalogue } from "../procurement";

const work = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
  catalogue: shadowCatalogue,
};

const opts = { controlPlane: cleanControlPlane, wakeAt: "2026-08-12T06:00:00.000Z", work };

describe("durable handoff sealing and verification", () => {
  it("seals a verifiable handoff that resumes the next wake-up at the next directive", async () => {
    const first = await runSchedulerCycle(opts);
    const sealed = first.sealedHandoff!;
    expect(sealed.digest).toBeTruthy();

    const verdict = verifyHandoff(cleanControlPlane, sealed);
    expect(verdict.accepted).toBe(true);
    if (verdict.accepted) expect(verdict.completedDirectiveIds).toEqual(["DIR-010"]);

    const second = await runSchedulerCycle({
      ...opts,
      wakeAt: "2026-08-12T06:20:00.000Z",
      handoff: sealed,
    });
    expect(second.evidence.directiveSelected).toBe("DIR-020");
    expect(second.evidence.resumedFromHandoff).toBe(sealed.cycleId);
  });

  it("refuses a tampered handoff instead of assuming completed work", async () => {
    const first = await runSchedulerCycle(opts);
    const tampered: HandoffRecord = {
      ...first.sealedHandoff!,
      completedDirectiveIds: ["DIR-010", "DIR-020"],
    };
    const verdict = verifyHandoff(cleanControlPlane, tampered);
    expect(verdict.accepted).toBe(false);

    const next = await runSchedulerCycle({ ...opts, handoff: tampered });
    expect(next.evidence.outcome).toBe("REFUSED");
    expect(next.evidence.directiveSelected).toBeNull();
    expect(next.run).toBeNull();
    expect(next.evidence.mutatedHouseholdState).toBe(false);
  });

  it("drops unknown and Test-class directive IDs from a handoff with explicit warnings", () => {
    const sealed = sealHandoff({
      cycleId: "CYCLE-X",
      controlPlaneSnapshotId: cleanControlPlane.snapshotId,
      wakeAt: opts.wakeAt,
      nextHandoff: {
        completedDirectiveIds: ["DIR-010", "DIR-001", "DIR-999"],
        nextDirectiveId: null,
      },
    } as unknown as Parameters<typeof sealHandoff>[0]);

    const verdict = verifyHandoff(cleanControlPlane, sealed);
    expect(verdict.accepted).toBe(true);
    if (verdict.accepted) {
      expect(verdict.completedDirectiveIds).toEqual(["DIR-010"]);
      expect(verdict.warnings.map((w) => w.code).sort()).toEqual([
        "TEST_CLASS_DIRECTIVE",
        "UNKNOWN_DIRECTIVE",
      ]);
    }
  });

  it("warns but still resumes when the control-plane snapshot rotated", async () => {
    const first = await runSchedulerCycle(opts);
    const rotated = { ...cleanControlPlane, snapshotId: "CP-SYNTH-0009" };
    const second = await runSchedulerCycle({
      ...opts,
      controlPlane: rotated,
      handoff: first.sealedHandoff!,
    });
    expect(second.evidence.handoffWarnings.map((w) => w.code)).toContain("SNAPSHOT_ROTATED");
    expect(second.evidence.directiveSelected).toBe("DIR-020");
  });
});

describe("duplicate wake-up delivery", () => {
  it("does no new work and replays the recorded evidence verbatim", async () => {
    const first = await runSchedulerCycle(opts);
    const replay = await runSchedulerCycle({
      ...opts,
      wakeLedger: [{ cycleId: first.evidence.cycleId, evidence: first.evidence }],
    });
    expect(replay.run).toBeNull();
    expect(replay.evidence.duplicateWakeOf).toBe(first.evidence.cycleId);
    expect({ ...replay.evidence, duplicateWakeOf: null }).toEqual(first.evidence);
    expect(replay.evidence.appendedEvents).toBe(false);
    expect(replay.evidence.dispatched).toBe(false);
  });

  it("still runs when the ledger holds a different wake-up", async () => {
    const first = await runSchedulerCycle(opts);
    const later = await runSchedulerCycle({
      ...opts,
      wakeAt: "2026-08-12T07:00:00.000Z",
      wakeLedger: [{ cycleId: first.evidence.cycleId, evidence: first.evidence }],
    });
    expect(later.evidence.duplicateWakeOf).toBeNull();
    expect(later.evidence.outcome).toBe("EXECUTED");
  });
});
