import { reconcileExpectedWithConfirmed } from "./expected-state/ledger";
import type { ConsumptionEvidence, ExpectedConsumption } from "./expected-state/types";
import type { HouseholdEvent } from "./state-engine/types";

const AS_OF = "2026-08-17T04:00:00.000Z";
const PAST = "2026-08-16T18:00:00.000Z";
const FUTURE = "2026-08-18T18:00:00.000Z";

function openingEvents(): HouseholdEvent[] {
  return [
    {
      eventId: "TEST-EXPECTED-OPENING-MILK",
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: "milk",
      occurredAt: "2026-08-16T08:00:00.000Z",
      payload: { quantity: 10, unit: "L", evidencePrecision: "EXACT" },
    },
    {
      eventId: "TEST-EXPECTED-OPENING-PASTA",
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: "pasta",
      occurredAt: "2026-08-16T08:00:00.000Z",
      payload: { quantity: 500, unit: "g", evidencePrecision: "EXACT" },
    },
  ];
}

function expectations(): ExpectedConsumption[] {
  return [
    {
      expectationId: "EXP-MILK-PAST",
      itemKey: "milk",
      quantity: 2,
      unit: "L",
      expectedAt: PAST,
      sourceId: "MEAL-PAST",
      recordClass: "Production",
    },
    {
      expectationId: "EXP-PASTA-FUTURE",
      itemKey: "pasta",
      quantity: 100,
      unit: "g",
      expectedAt: FUTURE,
      sourceId: "MEAL-FUTURE",
      recordClass: "Production",
    },
    {
      expectationId: "EXP-MISSING-PROVENANCE",
      itemKey: "milk",
      quantity: 9,
      unit: "L",
      expectedAt: PAST,
      sourceId: "MISSING-PROVENANCE",
    },
  ];
}

function evidence(): ConsumptionEvidence[] {
  return [
    {
      evidenceId: "EVID-MILK-PAST",
      expectationId: "EXP-MILK-PAST",
      itemKey: "milk",
      observedQuantity: 2,
      unit: "L",
      observedAt: PAST,
      actor: "synthetic-household",
      source: "TEST",
      confidence: "OBSERVED",
      recordClass: "Production",
    },
    {
      evidenceId: "EVID-PASTA-UNPLANNED",
      itemKey: "pasta",
      observedQuantity: 25,
      unit: "g",
      observedAt: AS_OF,
      actor: "synthetic-household",
      source: "TEST",
      confidence: "OBSERVED",
      recordClass: "Production",
    },
  ];
}

/**
 * Deterministic TEST-only runtime proof fixture for the expected/confirmed
 * consumption seam. No Airtable or household Production state is accessed.
 */
export function runExpectedConsumptionRuntimeProof() {
  const input = { openingEvents: openingEvents(), expectations: expectations(), evidence: evidence() };
  const inputBefore = JSON.stringify(input);
  const options = { asOf: AS_OF, now: () => AS_OF };
  const first = reconcileExpectedWithConfirmed(input, options);
  const second = reconcileExpectedWithConfirmed(input, options);

  const milk = first.forecast.find((item) => item.itemKey === "milk");
  const pasta = first.forecast.find((item) => item.itemKey === "pasta");

  const assertions = {
    pastExpectationBurned: milk?.expectedRemaining === 8,
    pastConfirmationBurned: milk?.confirmedRemaining === 8,
    futureExpectationNotBurned: pasta?.expectedRemaining === 500,
    futureConfirmationNotBurned: pasta?.confirmedRemaining === 475,
    missingProvenanceExpectationIgnored: first.entries.every(
      (entry) => entry.expectationId !== "EXP-MISSING-PROVENANCE",
    ),
    unplannedConfirmedConsumptionIsExplicit: first.entries.some(
      (entry) => entry.status === "UNEXPECTED_CONFIRMED" && entry.itemKey === "pasta",
    ),
    quantityHandoffUsesConfirmedState: first.handoff.items.some(
      (item) => item.itemKey === "milk" && item.quantity === 8,
    ),
    runtimeIsNonMutating: JSON.stringify(input) === inputBefore,
    deterministicReplay: JSON.stringify(first) === JSON.stringify(second),
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    mode: "TEST_ONLY",
    asOf: AS_OF,
    assertions,
    reconciliationStatus: first.reconciliationStatus,
    forecast: first.forecast,
    entries: first.entries,
    handoff: first.handoff,
    expectedEventCount: first.expectedEvents.length,
    confirmedEventCount: first.confirmedEvents.length,
  };
}
