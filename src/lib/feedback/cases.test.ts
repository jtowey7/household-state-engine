import { describe, expect, it } from "vitest";

import {
  FEEDBACK_CASES,
  attentionMeta,
  casesByAttention,
  hasExecutedPropagation,
  propagationLabel,
  type AttentionLevel,
} from "./cases";

describe("Feedback review — attention classes and propagation honesty", () => {
  it("represents all three attention classes exactly once", () => {
    const levels = FEEDBACK_CASES.map((c) => c.attention);
    for (const level of ["LOCAL", "DURABLE", "CRITICAL"] as AttentionLevel[]) {
      expect(levels.filter((l) => l === level)).toHaveLength(1);
    }
  });

  it("no case claims propagation has actually happened", () => {
    expect(hasExecutedPropagation(FEEDBACK_CASES)).toBe(false);
    for (const c of FEEDBACK_CASES) {
      expect(["NOT_STARTED", "AWAITING_RUNTIME"]).toContain(c.propagation);
      expect(propagationLabel[c.propagation]).toBeTruthy();
    }
  });

  it("a one-off observation stays local and never becomes a rule or preference", () => {
    const local = FEEDBACK_CASES.find((c) => c.attention === "LOCAL")!;
    expect(local.occurrences).toBe(1);
    expect(local.blocking).toBe(false);
    expect(local.consequence?.kind).toBe("NOTE");
    expect(local.affectedAreas).toHaveLength(1);
    expect(local.propagation).toBe("NOT_STARTED");
  });

  it("a repeated report becomes a durable preference with wider affected areas", () => {
    const durable = FEEDBACK_CASES.find((c) => c.attention === "DURABLE")!;
    const local = FEEDBACK_CASES.find((c) => c.attention === "LOCAL")!;
    expect(durable.occurrences).toBeGreaterThan(1);
    expect(durable.consequence?.kind).toBe("PREFERENCE");
    expect(durable.affectedAreas.length).toBeGreaterThan(local.affectedAreas.length);
    expect(durable.blocking).toBe(false);
    expect(durable.escalation).toBeNull();
  });

  it("the hard constraint blocks, escalates and has the broadest reach", () => {
    const critical = FEEDBACK_CASES.find((c) => c.attention === "CRITICAL")!;
    const durable = FEEDBACK_CASES.find((c) => c.attention === "DURABLE")!;
    expect(critical.blocking).toBe(true);
    expect(critical.escalation).toBeTruthy();
    expect(critical.consequence?.kind).toBe("RULE");
    expect(critical.affectedAreas.length).toBeGreaterThan(durable.affectedAreas.length);
  });

  it("only the safety-critical class is blocking", () => {
    expect(FEEDBACK_CASES.filter((c) => c.blocking).map((c) => c.attention)).toEqual(["CRITICAL"]);
  });

  it("every case carries evidence, provenance and a regression requirement", () => {
    for (const c of FEEDBACK_CASES) {
      expect(c.text.length).toBeGreaterThan(10);
      expect(c.evidenceSource).toBeTruthy();
      expect(c.actor).toBeTruthy();
      expect(c.regressionRequirement.length).toBeGreaterThan(10);
      expect(c.rationale).toBeTruthy();
    }
  });

  it("orders cases with the strongest attention first", () => {
    const ordered = casesByAttention(FEEDBACK_CASES);
    expect(ordered[0]!.attention).toBe("CRITICAL");
    expect(ordered.at(-1)!.attention).toBe("LOCAL");
    expect(attentionMeta.CRITICAL.order).toBeGreaterThan(attentionMeta.LOCAL.order);
  });
});
