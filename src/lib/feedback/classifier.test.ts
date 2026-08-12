import { describe, expect, it } from "vitest";

import { classifyFeedback, evaluateDownstreamAction } from "./classifier";
import {
  ambiguousReports,
  durableReports,
  oneOffReport,
  safetyReport,
  testClassReport,
} from "./classifier-fixtures";
import type { FeedbackReport } from "./types";

describe("Feedback classifier — attention levels", () => {
  it("clean path: a one-off report stays local and propagates nowhere durable", () => {
    const review = classifyFeedback([oneOffReport]);
    expect(review.status).toBe("CLEAN");
    expect(review.proposals).toHaveLength(1);
    const p = review.proposals[0]!;
    expect(p.attention).toBe("LOCAL");
    expect(p.consequence).toBe("NOTE");
    expect(p.decision).toBe("LOCAL_ONLY");
    expect(p.affectedAreas).toEqual(["MEAL_PLANNING"]);
    expect(p.requiresHumanApproval).toBe(false);
    expect(p.applied).toBe(false);
    expect(p.dispatched).toBe(false);
    expect(review.blockedAreas).toEqual([]);
  });

  it("persistent path: corroborated repeats become a durable preference over planning areas", () => {
    const review = classifyFeedback(durableReports);
    const p = review.proposals[0]!;
    expect(p.attention).toBe("DURABLE");
    expect(p.consequence).toBe("PREFERENCE");
    expect(p.decision).toBe("PROPAGATE_TO_AREAS");
    expect(p.occurrences).toBe(3);
    expect(p.affectedAreas).toEqual([
      "MEAL_PLANNING",
      "QUANTITIES",
      "SHOPPING_BASKET",
      "WASTE_FORECAST",
    ]);
    expect(p.affectedAreas).not.toContain("APPROVAL_GATE");
    expect(p.evidenceRefs).toEqual(["EVT-WASTE-0001", "EVT-WASTE-0002", "EVT-WASTE-0003"]);
    expect(p.requiresHumanApproval).toBe(true);
    expect(review.blockedAreas).toEqual([]);
  });

  it("repeats without confirmed-state evidence remain unpropagated and explicit", () => {
    const uncorroborated = durableReports.map(({ evidenceRefs: _e, ...rest }) => rest);
    const review = classifyFeedback(uncorroborated);
    const p = review.proposals[0]!;
    expect(p.decision).toBe("WITHHELD_AMBIGUOUS");
    expect(p.affectedAreas).toEqual([]);
    expect(review.exceptions.some((e) => e.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(review.status).toBe("EXCEPTIONS");
  });

  it("ambiguous evidence: conflicting direction withholds propagation without blocking", () => {
    const review = classifyFeedback(ambiguousReports);
    const p = review.proposals[0]!;
    expect(p.decision).toBe("WITHHELD_AMBIGUOUS");
    expect(p.affectedAreas).toEqual([]);
    expect(p.requiresHumanApproval).toBe(false);
    expect(review.status).toBe("EXCEPTIONS");
    expect(review.blockedAreas).toEqual([]);
  });

  it("hard-block path: one safety report blocks the broad downstream area set", () => {
    const review = classifyFeedback([safetyReport]);
    const p = review.proposals[0]!;
    expect(p.attention).toBe("CRITICAL");
    expect(p.consequence).toBe("RULE");
    expect(p.decision).toBe("BLOCK_DOWNSTREAM");
    expect(p.occurrences).toBe(1);
    expect(review.status).toBe("BLOCKED");
    expect(review.blockedAreas).toContain("APPROVAL_GATE");
    expect(review.blockedAreas).toContain("SUBSTITUTIONS");
  });
});

describe("Feedback classifier — integrity and replay", () => {
  it("identical duplicate delivery is idempotent and replay-stable", () => {
    const once = classifyFeedback([...durableReports, safetyReport]);
    const twice = classifyFeedback([...durableReports, safetyReport, ...durableReports]);
    expect(twice.reviewId).toBe(once.reviewId);
    expect(twice.proposals).toEqual(once.proposals);
    expect(twice.exceptions.filter((e) => e.code === "DUPLICATE_REPORT_IGNORED")).toHaveLength(3);
    expect(twice.ignoredFeedbackIds).toEqual(durableReports.map((r) => r.feedbackId));
  });

  it("deterministic IDs across repeated classification of the same input", () => {
    const a = classifyFeedback(durableReports);
    const b = classifyFeedback(durableReports);
    expect(b.reviewId).toBe(a.reviewId);
    expect(b.proposals.map((p) => p.proposalId)).toEqual(a.proposals.map((p) => p.proposalId));
  });

  it("conflicting payload on a reused Feedback ID causes no second application and blocks", () => {
    const conflicting: FeedbackReport = {
      ...oneOffReport,
      text: "Actually we loved the miso butter greens.",
      polarity: "PREFER",
    };
    const review = classifyFeedback([oneOffReport, conflicting]);
    expect(review.status).toBe("BLOCKED");
    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0]!.occurrences).toBe(1);
    expect(review.proposals[0]!.contributingFeedbackIds).toEqual(["FB-SYNTH-001"]);
    const conflict = review.exceptions.find(
      (e) => e.code === "REUSED_FEEDBACK_ID_PAYLOAD_CONFLICT",
    );
    expect(conflict?.blocking).toBe(true);
  });

  it("Record class = Test has zero effect on propagation", () => {
    const withTest = classifyFeedback([oneOffReport, testClassReport]);
    const withoutTest = classifyFeedback([oneOffReport]);
    expect(withTest.proposals).toEqual(withoutTest.proposals);
    expect(withTest.blockedAreas).toEqual([]);
    expect(withTest.ignoredFeedbackIds).toEqual(["FB-SYNTH-999"]);
    expect(withTest.exceptions.some((e) => e.code === "TEST_RECORD_EXCLUDED")).toBe(true);
  });

  it("provenance is preserved on every proposal", () => {
    const review = classifyFeedback([...durableReports, oneOffReport, safetyReport]);
    for (const p of review.proposals) {
      expect(p.contributingFeedbackIds.length).toBeGreaterThan(0);
      expect(p.proposalId.startsWith("FBP-")).toBe(true);
      expect(p.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe("Propagation gate — downstream actions", () => {
  it("hard constraint blocks affected downstream actions", () => {
    const review = classifyFeedback([safetyReport]);
    const decision = evaluateDownstreamAction(review, {
      area: "SHOPPING_BASKET",
      subject: "prawns",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.constrainingProposalIds).toEqual([review.proposals[0]!.proposalId]);
  });

  it("hard constraint does not block unrelated areas", () => {
    const review = classifyFeedback([safetyReport]);
    expect(
      evaluateDownstreamAction(review, { area: "WASTE_FORECAST", subject: "prawns" }).allowed,
    ).toBe(true);
  });

  it("durable preference shapes relevant areas without blocking them", () => {
    const review = classifyFeedback(durableReports);
    const shaped = evaluateDownstreamAction(review, {
      area: "SHOPPING_BASKET",
      subject: "leaf-salad",
    });
    expect(shaped.allowed).toBe(true);
    expect(shaped.constrainingProposalIds).toHaveLength(1);

    const unrelated = evaluateDownstreamAction(review, {
      area: "SHOPPING_BASKET",
      subject: "oats",
    });
    expect(unrelated.allowed).toBe(true);
    expect(unrelated.constrainingProposalIds).toEqual([]);
  });

  it("one-off feedback never constrains procurement", () => {
    const review = classifyFeedback([oneOffReport]);
    const decision = evaluateDownstreamAction(review, {
      area: "SHOPPING_BASKET",
      subject: "miso-butter-greens",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.constrainingProposalIds).toEqual([]);
  });

  it("unresolved payload conflict refuses downstream action on that subject only", () => {
    const review = classifyFeedback([
      oneOffReport,
      { ...oneOffReport, text: "changed", polarity: "PREFER" },
    ]);
    expect(
      evaluateDownstreamAction(review, { area: "MEAL_PLANNING", subject: "miso-butter-greens" })
        .allowed,
    ).toBe(false);
    expect(evaluateDownstreamAction(review, { area: "MEAL_PLANNING", subject: "oats" }).allowed).toBe(
      true,
    );
  });

  it("withheld ambiguous evidence neither blocks nor shapes downstream actions", () => {
    const review = classifyFeedback(ambiguousReports);
    const decision = evaluateDownstreamAction(review, {
      area: "SHOPPING_BASKET",
      subject: "haribo",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.constrainingProposalIds).toEqual([]);
  });
});
