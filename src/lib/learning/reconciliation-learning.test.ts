import { describe, expect, it } from "vitest";
import { reconcileExpectedWithConfirmed } from "../expected-state/ledger";
import { observationsFromReconciliation } from "./from-reconciliation";
import { analyseInventoryOutcomes } from "./variance";
import type { ConsumptionEvidence, ExpectedConsumption } from "../expected-state/types";

function runOne(expectationId: string, evidenceId: string, observedQuantity: number) {
  const expectation: ExpectedConsumption = {
    expectationId,
    itemKey: "chicken",
    quantity: 600,
    unit: "g",
    expectedAt: "2026-09-01T12:00:00.000Z",
    sourceId: `MEAL-${expectationId}`,
    recordClass: "Production",
  };
  const evidence: ConsumptionEvidence = {
    evidenceId,
    expectationId,
    itemKey: "chicken",
    observedQuantity,
    unit: "g",
    observedAt: "2026-09-01T12:30:00.000Z",
    confidence: "OBSERVED",
    recordClass: "Production",
  };

  return reconcileExpectedWithConfirmed(
    { expectations: [expectation], evidence: [evidence] },
    { asOf: "2026-09-01T13:00:00.000Z" },
  );
}

describe("repeated reconciliation -> governed learning", () => {
  it("requires independent expectations before a durable variance proposal exists", () => {
    const first = runOne("X-1", "E-1", 500);
    const second = runOne("X-2", "E-2", 450);

    const observations = [
      ...observationsFromReconciliation(first, [
        {
          evidenceId: "E-1",
          expectationId: "X-1",
          itemKey: "chicken",
          observedQuantity: 500,
          unit: "g",
          observedAt: "2026-09-01T12:30:00.000Z",
          confidence: "OBSERVED",
          recordClass: "Production",
        },
      ]),
      ...observationsFromReconciliation(second, [
        {
          evidenceId: "E-2",
          expectationId: "X-2",
          itemKey: "chicken",
          observedQuantity: 450,
          unit: "g",
          observedAt: "2026-09-02T12:30:00.000Z",
          confidence: "OBSERVED",
          recordClass: "Production",
        },
      ]),
    ];

    const learning = analyseInventoryOutcomes(observations);

    expect(observations.map((o) => o.observationId)).toEqual(["X-1", "X-2"]);
    expect(learning.proposals).toEqual([
      expect.objectContaining({
        itemKey: "chicken",
        direction: "under",
        repeatCount: 2,
        observationIds: ["X-1", "X-2"],
        promoted: false,
      }),
    ]);
  });

  it("does not turn a repeated evaluation of the same expectation into repeat evidence", () => {
    const first = runOne("X-1", "E-1", 500);
    const observations = observationsFromReconciliation(first, [
      {
        evidenceId: "E-1",
        expectationId: "X-1",
        itemKey: "chicken",
        observedQuantity: 500,
        unit: "g",
        observedAt: "2026-09-01T12:30:00.000Z",
        confidence: "OBSERVED",
        recordClass: "Production",
      },
    ]);

    const learning = analyseInventoryOutcomes([...observations, ...observations]);
    expect(learning.proposals).toEqual([]);
  });
});
