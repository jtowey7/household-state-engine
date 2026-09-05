import { describe, expect, it } from "vitest";
import type { ConsumptionEvidence, ReconciliationRun } from "../expected-state/types";
import { observationsFromReconciliation } from "./from-reconciliation";

const evidence = (overrides: Partial<ConsumptionEvidence> = {}): ConsumptionEvidence => ({
  evidenceId: "E-1",
  expectationId: "X-1",
  itemKey: "chicken",
  observedQuantity: 500,
  unit: "g",
  observedAt: "2026-09-01T06:00:00.000Z",
  confidence: "OBSERVED",
  recordClass: "Test",
  ...overrides,
});

const run = (overrides: Partial<ReconciliationRun["entries"][number]> = {}): Pick<ReconciliationRun, "entries"> => ({
  entries: [
    {
      status: "DIVERGED",
      itemKey: "chicken",
      expectationId: "X-1",
      evidenceIds: ["E-1"],
      expectedQuantity: 600,
      confirmedQuantity: 500,
      unit: "g",
      delta: -100,
      blocking: false,
      detail: "Observed below expectation",
      ...overrides,
    },
  ],
});

describe("observationsFromReconciliation", () => {
  it("adapts a reconciled divergence into the governed learning input", () => {
    expect(observationsFromReconciliation(run(), [evidence()])).toEqual([
      {
        observationId: "X-1",
        itemKey: "chicken",
        expectedQuantity: 600,
        observedQuantity: 500,
        unit: "g",
        occurredAt: "2026-09-01T06:00:00.000Z",
        source: "consumption",
      },
    ]);
  });

  it("does not create an observation from insufficient evidence", () => {
    expect(
      observationsFromReconciliation(run(), [evidence({ confidence: "UNKNOWN" })]),
    ).toEqual([]);
  });

  it("does not double-count multiple evidence records for one expectation", () => {
    expect(
      observationsFromReconciliation(run({ evidenceIds: ["E-1", "E-2"] }), [
        evidence(),
        evidence({ evidenceId: "E-2", observedAt: "2026-09-01T07:00:00.000Z" }),
      ]),
    ).toHaveLength(1);
  });

  it("ignores unmatched or not-due entries", () => {
    expect(
      observationsFromReconciliation(
        run({ status: "AWAITING_EVIDENCE", evidenceIds: [] }),
        [evidence()],
      ),
    ).toEqual([]);
  });

  it("selects the latest supporting evidence timestamp deterministically", () => {
    const result = observationsFromReconciliation(
      run({ evidenceIds: ["E-2", "E-1"] }),
      [
        evidence({ evidenceId: "E-2", observedAt: "2026-09-01T07:00:00.000Z" }),
        evidence({ evidenceId: "E-1", observedAt: "2026-09-01T06:00:00.000Z" }),
      ],
    );

    expect(result[0]?.occurredAt).toBe("2026-09-01T07:00:00.000Z");
  });

  it("rejects evidence bound to a different expectation", () => {
    expect(
      observationsFromReconciliation(run(), [
        evidence({ expectationId: "X-2" }),
      ]),
    ).toEqual([]);
  });

  it("rejects evidence bound to a different item", () => {
    expect(
      observationsFromReconciliation(run(), [
        evidence({ itemKey: "beef" }),
      ]),
    ).toEqual([]);
  });

  it("ignores mismatched evidence but retains matching evidence for the same entry", () => {
    expect(
      observationsFromReconciliation(run({ evidenceIds: ["E-2", "E-1"] }), [
        evidence({ evidenceId: "E-2", expectationId: "X-2", observedAt: "2026-09-01T08:00:00.000Z" }),
        evidence({ evidenceId: "E-1", observedAt: "2026-09-01T06:00:00.000Z" }),
      ]),
    ).toHaveLength(1);
  });
});
