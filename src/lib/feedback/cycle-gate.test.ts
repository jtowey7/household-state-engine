import { describe, expect, it } from "vitest";

import { evaluateCycleFeedbackGate } from "./cycle-gate";
import {
  ambiguousReports,
  durableReports,
  oneOffReport,
  safetyReport,
  testClassReport,
} from "./classifier-fixtures";
import { runWeeklyShadowCycle, weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";

const opts = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

describe("cycle feedback gate (unit)", () => {
  it("allows the cycle when there is no feedback at all", () => {
    const gate = evaluateCycleFeedbackGate([]);
    expect(gate.allowed).toBe(true);
    expect(gate.refusedAreas).toEqual([]);
    expect(gate.isolatedItemKeys).toEqual([]);
    expect(gate.preferenceProposals).toEqual([]);
  });

  it("refuses the gated areas on a hard safety constraint", () => {
    const gate = evaluateCycleFeedbackGate([safetyReport]);
    expect(gate.allowed).toBe(false);
    expect(gate.refusedAreas).toEqual(["QUANTITIES", "SHOPPING_BASKET"]);
    expect(gate.blockingReasons.length).toBeGreaterThan(0);
    expect(gate.applied).toBe(false);
    expect(gate.dispatched).toBe(false);
  });

  it("surfaces durable preferences as proposals without blocking", () => {
    const gate = evaluateCycleFeedbackGate(durableReports);
    expect(gate.allowed).toBe(true);
    expect(gate.preferenceProposals).toHaveLength(1);
    const proposal = gate.preferenceProposals[0]!;
    expect(proposal.attention).toBe("DURABLE");
    expect(proposal.applied).toBe(false);
    expect(proposal.requiresHumanApproval).toBe(true);
    expect(proposal.evidenceRefs).toEqual(["EVT-WASTE-0001", "EVT-WASTE-0002", "EVT-WASTE-0003"]);
  });

  it("keeps a one-off local and ambiguous evidence unpropagated", () => {
    const gate = evaluateCycleFeedbackGate([oneOffReport, ...ambiguousReports]);
    expect(gate.allowed).toBe(true);
    expect(gate.preferenceProposals).toEqual([]);
    const haribo = gate.review.proposals.find((p) => p.subject === "haribo")!;
    expect(haribo.decision).toBe("WITHHELD_AMBIGUOUS");
    expect(haribo.affectedAreas).toEqual([]);
  });

  it("gives Record class = Test feedback zero effect on the gate", () => {
    const gate = evaluateCycleFeedbackGate([testClassReport]);
    expect(gate.allowed).toBe(true);
    expect(gate.refusedAreas).toEqual([]);
    expect(gate.review.ignoredFeedbackIds).toContain(testClassReport.feedbackId);
  });

  it("isolates only the mapped items for a conflicted subject", () => {
    const conflict = { ...durableReports[0]!, text: "different canonical payload" };
    const gate = evaluateCycleFeedbackGate([...durableReports, conflict], {
      subjectItemKeys: { "leaf-salad": ["lettuce-gem"] },
    });
    expect(gate.isolatedItemKeys).toEqual(["lettuce-gem"]);
    expect(gate.allowed).toBe(true);
  });

  it("is idempotent: repeated evaluation yields an identical gate", () => {
    const a = evaluateCycleFeedbackGate(durableReports);
    const b = evaluateCycleFeedbackGate([...durableReports, durableReports[0]!]);
    expect(a.gateId).toBe(evaluateCycleFeedbackGate(durableReports).gateId);
    expect(b.preferenceProposals.map((p) => p.proposalId)).toEqual(
      a.preferenceProposals.map((p) => p.proposalId),
    );
  });
});

describe("feedback gate wired into the weekly shadow cycle", () => {
  it("runs the gate stage between HANDOFF and QUANTITY_PLAN", async () => {
    const run = await runWeeklyShadowCycle(opts);
    const ids = run.stages.map((s) => s.stage);
    expect(ids.indexOf("FEEDBACK_GATE")).toBe(ids.indexOf("HANDOFF") + 1);
    expect(ids.indexOf("FEEDBACK_GATE")).toBeLessThan(ids.indexOf("QUANTITY_PLAN"));
    expect(run.feedbackGate?.allowed).toBe(true);
    expect(run.status).toBe("COMPLETED");
  });

  it("refuses before quantity/procurement on a hard constraint", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, feedbackReports: [safetyReport] });
    expect(run.status).toBe("REFUSED");
    expect(run.plan).toBeNull();
    expect(run.basket).toBeNull();
    expect(run.feedbackGate?.refusedAreas).toContain("QUANTITIES");
    const skipped = run.stages.filter((s) => s.status === "SKIPPED").map((s) => s.stage);
    expect(skipped).toEqual(["RECEIVE_DELIVERY", "QUANTITY_PLAN", "AGGREGATE_PROCUREMENT"]);
    expect(run.approval.readyForReview).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.mutatedHouseholdState).toBe(false);
  });

  it("still replays and proposes appends even when the gate refuses", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, feedbackReports: [safetyReport] });
    expect(run.snapshot).not.toBeNull();
    expect(run.handoff).not.toBeNull();
    expect(run.appendedEvents).toBe(false);
  });

  it("carries durable preferences through as proposals and keeps planning", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, feedbackReports: durableReports });
    expect(run.status).toBe("COMPLETED");
    expect(run.feedbackGate?.preferenceProposals).toHaveLength(1);
    expect(run.feedbackGate?.preferenceProposals[0]?.applied).toBe(false);
    expect(run.plan?.requirements.length).toBeGreaterThan(0);
  });

  it("isolates a constrained item without refusing unrelated planning", async () => {
    const conflict = { ...durableReports[0]!, text: "conflicting canonical payload" };
    const run = await runWeeklyShadowCycle({
      ...opts,
      feedbackReports: [...durableReports, conflict],
      feedbackSubjectItemKeys: { "leaf-salad": ["oats-rolled"] },
    });
    expect(run.status).toBe("COMPLETED");
    expect(run.isolatedItemKeys).toContain("oats-rolled");
    expect(run.plan?.requirements.map((r) => r.itemKey)).not.toContain("oats-rolled");
    expect(run.plan!.requirements.length).toBeGreaterThan(0);
  });

  it("gives Test-class feedback zero effect on the cycle outcome", async () => {
    const clean = await runWeeklyShadowCycle(opts);
    const withTest = await runWeeklyShadowCycle({ ...opts, feedbackReports: [testClassReport] });
    expect(withTest.status).toBe("COMPLETED");
    expect(withTest.plan!.planId).toBe(clean.plan!.planId);
    expect(withTest.basket!.basketId).toBe(clean.basket!.basketId);
  });

  it("is idempotent across repeated wake-ups with the same feedback", async () => {
    const a = await runWeeklyShadowCycle({ ...opts, feedbackReports: durableReports });
    const b = await runWeeklyShadowCycle({ ...opts, feedbackReports: durableReports });
    expect(b.cycleId).toBe(a.cycleId);
    expect(b.feedbackGate!.gateId).toBe(a.feedbackGate!.gateId);
    expect(b.feedbackGate!.review.reviewId).toBe(a.feedbackGate!.review.reviewId);
  });
});
