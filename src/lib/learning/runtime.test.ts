import { describe, expect, it } from "vitest";
import { runGovernedLearning } from "./runtime";

const entry = (expectationId: string, confirmedQuantity: number) => ({
  status: "DIVERGED" as const,
  itemKey: "rice",
  expectationId,
  evidenceIds: [`EVIDENCE:${expectationId}`],
  expectedQuantity: 100,
  confirmedQuantity,
  unit: "g",
  delta: confirmedQuantity - 100,
  blocking: false,
  detail: "confirmed consumption",
});

const evidence = (expectationId: string, observedAt: string) => ({
  evidenceId: `EVIDENCE:${expectationId}`,
  expectationId,
  itemKey: "rice",
  observedQuantity: 80,
  unit: "g",
  observedAt,
  confidence: "OBSERVED" as const,
  recordClass: "Production" as const,
});

describe("governed learning runtime composition", () => {
  it("composes reconciliation into the existing proposal-only learning analyser", () => {
    const run = runGovernedLearning(
      { entries: [entry("EXPECTATION:1", 80), entry("EXPECTATION:2", 80)] },
      [
        evidence("EXPECTATION:1", "2026-09-01T18:00:00.000Z"),
        evidence("EXPECTATION:2", "2026-09-02T18:00:00.000Z"),
      ],
      { runId: "LEARNING-RUN-1" },
    );

    expect(run.runId).toBe("LEARNING-RUN-1");
    expect(run.observations).toHaveLength(2);
    expect(run.result.proposals).toEqual([
      expect.objectContaining({
        itemKey: "rice",
        direction: "under",
        repeatCount: 2,
        observationIds: ["EXPECTATION:1", "EXPECTATION:2"],
        promoted: false,
      }),
    ]);
    expect(run.proposalOnly).toBe(true);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.promoted).toBe(false);
  });

  it("suppresses learning when reconciliation has insufficient evidence", () => {
    const run = runGovernedLearning(
      { entries: [entry("EXPECTATION:1", 80)] },
      [evidence("EXPECTATION:1", "2026-09-01T18:00:00.000Z")],
    );

    expect(run.observations).toHaveLength(1);
    expect(run.result.proposals).toEqual([]);
    expect(run.proposalOnly).toBe(true);
    expect(run.mutatedHouseholdState).toBe(false);
  });

  it("rejects conflicting duplicate observation identities through the existing analyser", () => {
    expect(() =>
      runGovernedLearning(
        {
          entries: [
            entry("EXPECTATION:1", 80),
            entry("EXPECTATION:1", 70),
          ],
        },
        [evidence("EXPECTATION:1", "2026-09-01T18:00:00.000Z")],
      ),
    ).toThrow(/Conflicting observations/);
  });
});
