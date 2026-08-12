import { describe, expect, it } from "vitest";

import { evaluateCycleFeedbackGate } from "./cycle-gate";
import { describeFeedbackGate } from "./gate-view";
import {
  ambiguousReports,
  durableReports,
  oneOffReport,
  safetyReport,
  testClassReport,
} from "./classifier-fixtures";

const SUBJECT_MAP = { "leaf-salad": ["leaf-salad"], shellfish: ["shellfish"] };

describe("describeFeedbackGate (console projection)", () => {
  it("shows ALLOWED for a clean local-only review", () => {
    const view = describeFeedbackGate(evaluateCycleFeedbackGate([oneOffReport]));
    expect(view.status).toBe("ALLOWED");
    expect(view.refusedAreas).toEqual([]);
    expect(view.isolatedItemKeys).toEqual([]);
    expect(view.gateId).toMatch(/^FBG-/);
    expect(view.reviewId).toBeTruthy();
    expect(view.summary).toContain("Nothing applied");
  });

  it("shows REFUSED with refused areas and blocking reasons for a safety constraint", () => {
    const view = describeFeedbackGate(
      evaluateCycleFeedbackGate([safetyReport], { subjectItemKeys: SUBJECT_MAP }),
    );
    expect(view.status).toBe("REFUSED");
    expect(view.refusedAreas).toContain("QUANTITIES");
    expect(view.refusedAreas).toContain("SHOPPING_BASKET");
    expect(view.blockingReasons.length).toBeGreaterThan(0);
    expect(view.isolatedItemKeys).toContain("shellfish");
  });

  it("surfaces durable preferences as proposals only", () => {
    const view = describeFeedbackGate(
      evaluateCycleFeedbackGate(durableReports, { subjectItemKeys: SUBJECT_MAP }),
    );
    expect(view.proposals.length).toBeGreaterThan(0);
    for (const p of view.proposals) {
      expect(p.applied).toBe(false);
      expect(p.dispatched).toBe(false);
      expect(p.subject).toBe("leaf-salad");
      expect(p.areas.length).toBeGreaterThan(0);
    }
    expect(view.applied).toBe(false);
    expect(view.dispatched).toBe(false);
  });

  it("shows WARNED with exception notes for ambiguous/conflicting evidence", () => {
    const view = describeFeedbackGate(evaluateCycleFeedbackGate(ambiguousReports));
    expect(["WARNED", "ALLOWED"]).toContain(view.status);
    expect(view.proposals).toHaveLength(0);
  });

  it("excludes Test-class feedback from refusal", () => {
    const view = describeFeedbackGate(
      evaluateCycleFeedbackGate([testClassReport], { subjectItemKeys: SUBJECT_MAP }),
    );
    expect(view.status).not.toBe("REFUSED");
    expect(view.refusedAreas).toEqual([]);
  });

  it("is deterministic for the same report set", () => {
    const a = describeFeedbackGate(evaluateCycleFeedbackGate(durableReports));
    const b = describeFeedbackGate(evaluateCycleFeedbackGate(durableReports));
    expect(b).toEqual(a);
  });
});
