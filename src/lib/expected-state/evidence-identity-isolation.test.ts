import { describe, expect, it } from "vitest";

import { reconcileExpectedWithConfirmed } from "./ledger";
import type { ConsumptionEvidence, ExpectedConsumption } from "./types";

const options = { asOf: "2026-09-01T20:00:00.000Z", now: () => "2026-09-01T20:00:00.000Z" };

const opening = {
  eventId: "opening-chicken",
  recordClass: "Production" as const,
  eventType: "ITEM_STOCK_SET" as const,
  itemKey: "chicken",
  occurredAt: "2026-09-01T06:00:00.000Z",
  payload: { quantity: 1200, unit: "g" },
};

const expectation = (overrides: Partial<ExpectedConsumption> = {}): ExpectedConsumption => ({
  expectationId: "EXPECTED:meal-1:chicken",
  itemKey: "chicken",
  quantity: 600,
  unit: "g",
  expectedAt: "2026-09-01T18:00:00.000Z",
  sourceId: "meal-1",
  recordClass: "Production",
  ...overrides,
});

const evidence = (overrides: Partial<ConsumptionEvidence> = {}): ConsumptionEvidence => ({
  evidenceId: "EV-1",
  expectationId: "EXPECTED:meal-1:chicken",
  itemKey: "chicken",
  observedQuantity: 500,
  unit: "g",
  observedAt: "2026-09-01T19:00:00.000Z",
  confidence: "OBSERVED",
  recordClass: "Production",
  ...overrides,
});

describe("evidence identity isolation", () => {
  it("never attributes one evidenceId to more than one reconciliation entry", () => {
    const result = reconcileExpectedWithConfirmed(
      {
        openingEvents: [opening],
        // Same expectation identity declared twice (e.g. two plan rows collapsing
        // onto one identity). Historically this attributed EV-1 to both entries.
        expectations: [expectation(), expectation({ sourceId: "meal-1-duplicate" })],
        evidence: [evidence()],
      },
      options,
    );

    const attributions = result.entries.flatMap((entry) => entry.evidenceIds);
    expect(attributions.filter((id) => id === "EV-1")).toHaveLength(0);
    expect(new Set(attributions).size).toBe(attributions.length);
  });

  it("fails closed on a reused expectation id instead of manufacturing repeat variance", () => {
    const result = reconcileExpectedWithConfirmed(
      {
        openingEvents: [opening],
        expectations: [expectation(), expectation({ sourceId: "meal-1-duplicate" })],
        evidence: [evidence()],
      },
      options,
    );

    const conflicts = result.entries.filter(
      (entry) => entry.status === "EXPECTATION_IDENTITY_CONFLICT",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      itemKey: "chicken",
      expectationId: "EXPECTED:meal-1:chicken",
      blocking: true,
    });
    expect(result.blockedItemKeys).toContain("chicken");
    expect(result.reconciliationStatus).toBe("BLOCKED");
    expect(result.handoff.items.map((item) => item.itemKey)).not.toContain("chicken");
    // No DIVERGED pair is produced, so no repeatable-variance evidence can exist.
    expect(result.entries.some((entry) => entry.status === "DIVERGED")).toBe(false);
  });

  it("withholds a conflicted expectation from confirmed household state", () => {
    const result = reconcileExpectedWithConfirmed(
      {
        openingEvents: [opening],
        expectations: [expectation(), expectation({ sourceId: "meal-1-duplicate" })],
        evidence: [evidence()],
      },
      options,
    );

    expect(result.confirmedEvents.map((event) => event.eventId)).toEqual(["opening-chicken"]);
    expect(
      result.confirmedSnapshot.items.find((item) => item.itemKey === "chicken")?.quantity,
    ).toBe(1200);
  });

  it("still reconciles normally when every expectation identity is distinct", () => {
    const result = reconcileExpectedWithConfirmed(
      {
        openingEvents: [opening],
        expectations: [
          expectation(),
          expectation({ expectationId: "EXPECTED:meal-2:chicken", sourceId: "meal-2" }),
        ],
        evidence: [
          evidence({ observedQuantity: 600 }),
          evidence({
            evidenceId: "EV-2",
            expectationId: "EXPECTED:meal-2:chicken",
            observedQuantity: 600,
          }),
        ],
      },
      options,
    );

    expect(result.entries.map((entry) => entry.status)).toEqual(["MATCHED", "MATCHED"]);
    const attributions = result.entries.flatMap((entry) => entry.evidenceIds);
    expect(attributions).toEqual(["EV-1", "EV-2"]);
    expect(result.reconciliationStatus).toBe("CLEAN");
  });

  it("keeps the conflicted-identity outcome deterministic across repeats", () => {
    const input = {
      openingEvents: [opening],
      expectations: [expectation(), expectation({ sourceId: "meal-1-duplicate" })],
      evidence: [evidence()],
    };

    expect(reconcileExpectedWithConfirmed(input, options)).toEqual(
      reconcileExpectedWithConfirmed(input, options),
    );
  });
});
