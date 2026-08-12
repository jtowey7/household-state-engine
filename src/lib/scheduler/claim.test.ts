import { describe, expect, it } from "vitest";

import {
  claimDirective,
  cleanControlPlane,
  createMemoryAgentRunSink,
  pruneClaims,
  runSchedulerCycle,
  toAgentRunRecord,
  type DirectiveClaim,
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

const wakeAt = "2026-08-12T06:00:00.000Z";
const opts = { controlPlane: cleanControlPlane, wakeAt, work };

describe("directive claim / lease", () => {
  it("grants a deterministic lease when nothing holds the directive", () => {
    const a = claimDirective({ directiveId: "DIR-010", cycleId: "CYCLE-A", wakeAt });
    const b = claimDirective({ directiveId: "DIR-010", cycleId: "CYCLE-A", wakeAt });
    expect(a.granted && b.granted).toBe(true);
    if (a.granted && b.granted) expect(a.claim).toEqual(b.claim);
  });

  it("refuses a directive already leased by a different live cycle", () => {
    const first = claimDirective({ directiveId: "DIR-010", cycleId: "CYCLE-A", wakeAt });
    expect(first.granted).toBe(true);
    if (!first.granted) return;
    const second = claimDirective({
      directiveId: "DIR-010",
      cycleId: "CYCLE-B",
      wakeAt: "2026-08-12T06:05:00.000Z",
      activeClaims: [first.claim],
    });
    expect(second.granted).toBe(false);
    if (!second.granted) expect(second.refusal.code).toBe("CLAIMED_BY_ANOTHER_CYCLE");
  });

  it("reclaims a lease that has expired rather than wedging the directive", () => {
    const stale: DirectiveClaim = {
      claimId: "CLAIM-STALE",
      directiveId: "DIR-010",
      cycleId: "CYCLE-DEAD",
      claimedAt: "2026-08-12T05:00:00.000Z",
      expiresAt: "2026-08-12T05:15:00.000Z",
    };
    const verdict = claimDirective({
      directiveId: "DIR-010",
      cycleId: "CYCLE-B",
      wakeAt,
      activeClaims: [stale],
    });
    expect(verdict.granted).toBe(true);
    if (verdict.granted) expect(verdict.reclaimedExpired).toBe(true);
    expect(pruneClaims([stale], wakeAt)).toEqual([]);
  });

  it("blocks the cycle without doing work when the directive is claimed elsewhere", async () => {
    const first = await runSchedulerCycle(opts);
    const held: DirectiveClaim = {
      ...first.evidence.claim!,
      cycleId: "CYCLE-OTHER",
      claimId: "CLAIM-OTHER",
    };
    const second = await runSchedulerCycle({ ...opts, activeClaims: [held] });
    expect(second.evidence.outcome).toBe("BLOCKED");
    expect(second.run).toBeNull();
    expect(second.evidence.claim).toBeNull();
    expect(second.evidence.proposalIds).toEqual([]);
    expect(second.evidence.nextHandoff.completedDirectiveIds).toEqual([]);
  });

  it("holds a lease over the directive it actually executed", async () => {
    const { evidence } = await runSchedulerCycle(opts);
    expect(evidence.outcome).toBe("EXECUTED");
    expect(evidence.claim?.directiveId).toBe("DIR-010");
    expect(evidence.claim?.cycleId).toBe(evidence.cycleId);
    expect(Date.parse(evidence.claim!.expiresAt)).toBeGreaterThan(Date.parse(wakeAt));
  });
});

describe("AGENT RUN evidence record", () => {
  it("derives an Airtable-shaped run row that preserves provenance and boundaries", async () => {
    const { evidence, agentRun } = await runSchedulerCycle(opts);
    expect(agentRun).toBeTruthy();
    expect(agentRun!["Run ID"]).toBe(`RUN-${evidence.cycleId}`);
    expect(agentRun!["Record class"]).toBe("Test");
    expect(agentRun!.Mode).toBe("SYNTHETIC");
    expect(agentRun!["Directive selected"]).toBe("DIR-010");
    expect(agentRun!["Claim ID"]).toBe(evidence.claim?.claimId);
    expect(agentRun!["Snapshot ID"]).toBe(evidence.nextHandoff.snapshotId);
    expect(agentRun!["Replay ID"]).toBe(evidence.nextHandoff.replayId);
    expect(agentRun!["Plan ID"]).toBe(evidence.nextHandoff.planId);
    expect(agentRun!["Basket ID"]).toBe(evidence.nextHandoff.basketId);
    expect(agentRun!["Proposal IDs"]).toEqual(evidence.proposalIds);
    expect(agentRun!["Mutated household state"]).toBe(false);
    expect(agentRun!["Appended events"]).toBe(false);
    expect(agentRun!.Dispatched).toBe(false);
    expect(agentRun!["Requires human approval"]).toBe(true);
  });

  it("is deterministic for the same wake-up", async () => {
    const a = await runSchedulerCycle(opts);
    const b = await runSchedulerCycle(opts);
    expect(b.agentRun).toEqual(a.agentRun);
    expect(toAgentRunRecord(a.evidence)).toEqual(a.agentRun);
  });

  it("appends one row per wake-up and dedupes a duplicate delivery", async () => {
    const sink = createMemoryAgentRunSink();
    const first = await runSchedulerCycle({ ...opts, agentRunSink: sink });
    expect(first.agentRunReceipt?.persisted).toBe(true);

    const duplicate = await runSchedulerCycle({
      ...opts,
      agentRunSink: sink,
      wakeLedger: [{ cycleId: first.evidence.cycleId, evidence: first.evidence }],
    });
    expect(duplicate.evidence.duplicateWakeOf).toBe(first.evidence.cycleId);
    expect(duplicate.agentRunReceipt?.deduplicated).toBe(true);
    expect(sink.list()).toHaveLength(1);
  });

  it("records the next wake-up as a separate run row", async () => {
    const sink = createMemoryAgentRunSink();
    const first = await runSchedulerCycle({ ...opts, agentRunSink: sink });
    const second = await runSchedulerCycle({
      ...opts,
      agentRunSink: sink,
      wakeAt: "2026-08-12T06:20:00.000Z",
      handoff: first.sealedHandoff!,
    });
    expect(second.evidence.directiveSelected).toBe("DIR-020");
    expect(sink.list()).toHaveLength(2);
    expect(sink.list()[1]!["Directive selected"]).toBe("DIR-020");
  });
});
