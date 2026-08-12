import { describe, expect, it } from "vitest";
import { runLabCase, runLabSuite, runReplayToQuantityIntegration } from "./harness";
import { labCases, labNow, labTargets } from "./cases";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter";

const OPTS = { targets: labTargets, now: labNow };

describe("TEST LAB integration cases", () => {
  for (const lab of labCases) {
    it(`${lab.caseId} — ${lab.title}`, () => {
      const result = runLabCase(lab, OPTS);
      const failed = result.checks.filter((c) => !c.passed);
      expect(failed.map((c) => `${c.label}: ${c.detail}`)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.dispatched).toBe(false);
    });
  }

  it("suite reports all cases passing", () => {
    const suite = runLabSuite(labCases, OPTS);
    expect(suite.failed).toBe(0);
    expect(suite.passed).toBe(labCases.length);
  });
});

describe("adapter cannot silently fall back to static inventory", () => {
  it("refuses when no snapshot is supplied", () => {
    for (const input of [null, undefined] as const) {
      const plan = adaptSnapshotToQuantityRun(input, { targets: labTargets });
      expect(plan.executed).toBe(false);
      expect(plan.eligibleForProcurement).toBe(false);
      expect(plan.requirements).toEqual([]);
      expect(plan.rejections[0]!.code).toBe("MISSING_REPLAY_SNAPSHOT");
      expect(plan.rejections[0]!.fatal).toBe(true);
    }
  });

  it("refuses on a BLOCKED replay rather than emitting requirements", () => {
    const blocked = labCases.find((c) => c.caseId === "LAB-D")!;
    const run = runReplayToQuantityIntegration(blocked.events, OPTS);
    expect(run.reconciliationStatus).toBe("BLOCKED");
    expect(run.plan.requirements).toEqual([]);
    expect(run.plan.rejections.map((r) => r.code)).toEqual(["RECONCILIATION_BLOCKED"]);
    expect(run.dispatched).toBe(false);
  });
});

describe("integration determinism", () => {
  it("repeats byte-identically for the same synthetic stream", () => {
    const events = labCases[0]!.events;
    const a = runReplayToQuantityIntegration(events, OPTS);
    const b = runReplayToQuantityIntegration(events, OPTS);
    expect(a).toEqual(b);
    expect(a.plan.planId).toBe(b.plan.planId);
  });
});
