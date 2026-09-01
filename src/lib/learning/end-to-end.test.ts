import { describe, expect, it } from "vitest";
import { reconcileExpectedWithConfirmed } from "../expected-state/ledger";
import { analyseInventoryOutcomes } from "./variance";
import { observationsFromReconciliation } from "./from-reconciliation";
import { buildDeliveryInventoryTransition } from "../state-engine/delivery-inventory";

describe("delivery -> reconciliation -> governed learning", () => {
  it("carries one delivery outcome through the complete pure closed-loop seam", () => {
    const delivery = buildDeliveryInventoryTransition({
      deliveryId: "DEL-1",
      deliveredAt: "2026-09-01T08:00:00.000Z",
      reconciliationStatus: "RECONCILED",
      lines: [
        {
          lineId: "LINE-1",
          itemKey: "chicken",
          deliveredQuantity: 1000,
          unit: "g",
        },
      ],
    });

    const reconciliation = reconcileExpectedWithConfirmed(
      {
        openingEvents: delivery.events,
        expectations: [
          {
            expectationId: "X-1",
            itemKey: "chicken",
            quantity: 600,
            unit: "g",
            expectedAt: "2026-09-01T12:00:00.000Z",
            sourceId: "MEAL-1",
            recordClass: "Production",
          },
        ],
        evidence: [
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
        ],
      },
      { asOf: "2026-09-01T13:00:00.000Z" },
    );

    expect(reconciliation.entries).toContainEqual(
      expect.objectContaining({
        status: "DIVERGED",
        expectationId: "X-1",
        expectedQuantity: 600,
        confirmedQuantity: 500,
      }),
    );
    expect(reconciliation.blockedItemKeys).toContain("chicken");

    const observations = observationsFromReconciliation(
      reconciliation,
      [
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
      ],
    );

    expect(observations).toEqual([
      {
        observationId: "X-1",
        itemKey: "chicken",
        expectedQuantity: 600,
        observedQuantity: 500,
        unit: "g",
        occurredAt: "2026-09-01T12:30:00.000Z",
        source: "consumption",
      },
    ]);

    const learning = analyseInventoryOutcomes(observations);
    expect(learning.signals).toHaveLength(1);
    expect(learning.signals[0]).toMatchObject({
      itemKey: "chicken",
      direction: "under",
      delta: -100,
    });
    expect(learning.proposals).toEqual([]);
  });

  it("does not allow a TEST evidence record to enter the production reconciliation learning path", () => {
    const reconciliation = reconcileExpectedWithConfirmed(
      {
        expectations: [
          {
            expectationId: "X-2",
            itemKey: "chicken",
            quantity: 600,
            unit: "g",
            expectedAt: "2026-09-01T12:00:00.000Z",
            sourceId: "MEAL-2",
            recordClass: "Production",
          },
        ],
        evidence: [
          {
            evidenceId: "TEST-E-1",
            expectationId: "X-2",
            itemKey: "chicken",
            observedQuantity: 500,
            unit: "g",
            observedAt: "2026-09-01T12:30:00.000Z",
            confidence: "OBSERVED",
            recordClass: "Test",
          },
        ],
      },
      { asOf: "2026-09-01T13:00:00.000Z" },
    );

    expect(reconciliation.entries).toContainEqual(
      expect.objectContaining({ status: "AWAITING_EVIDENCE", expectationId: "X-2" }),
    );
    expect(
      observationsFromReconciliation(reconciliation, [
        {
          evidenceId: "TEST-E-1",
          expectationId: "X-2",
          itemKey: "chicken",
          observedQuantity: 500,
          unit: "g",
          observedAt: "2026-09-01T12:30:00.000Z",
          confidence: "OBSERVED",
          recordClass: "Test",
        },
      ]),
    ).toEqual([]);
  });
});
