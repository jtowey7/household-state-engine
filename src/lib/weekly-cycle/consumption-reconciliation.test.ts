import { describe, expect, it } from "vitest";

import { consumptionFixture } from "../consumption/fixtures";
import type { ConsumptionEvidence } from "../expected-state";
import { createMemoryProductionPort } from "../production-adapter";
import {
  runWeeklyShadowCycleWithConsumptionReconciliation,
  weeklyAsOf,
  weeklyNow,
  weeklyPlan,
  weeklyPort,
  weeklyScope,
} from ".";

const options = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

const evidence: ConsumptionEvidence[] = [
  {
    evidenceId: "EVID-MEAL-3001-OATS",
    expectationId: "EXPECTED:MEAL-3001:oats-rolled",
    itemKey: "oats-rolled",
    observedQuantity: 300,
    unit: "g",
    observedAt: "2026-08-02T08:30:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-MEAL-3002-OATS",
    expectationId: "EXPECTED:MEAL-3002:oats-rolled",
    itemKey: "oats-rolled",
    observedQuantity: 300,
    unit: "g",
    observedAt: "2026-08-03T08:30:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-MEAL-3001-MILK",
    expectationId: "EXPECTED:MEAL-3001:milk-whole",
    itemKey: "milk-whole",
    observedQuantity: 1,
    unit: "L",
    observedAt: "2026-08-02T08:30:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-UNPLANNED-MILK",
    itemKey: "milk-whole",
    observedQuantity: 0.5,
    unit: "L",
    observedAt: "2026-08-02T21:00:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-ICE-1",
    expectationId: "EXPECTED:ALLOC-ICE:2026-08-01",
    itemKey: "ice-cream-tub",
    observedQuantity: 2,
    unit: "count",
    observedAt: "2026-08-01T23:00:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-ICE-2",
    expectationId: "EXPECTED:ALLOC-ICE:2026-08-02",
    itemKey: "ice-cream-tub",
    observedQuantity: 2,
    unit: "count",
    observedAt: "2026-08-02T23:00:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-ICE-3",
    expectationId: "EXPECTED:ALLOC-ICE:2026-08-03",
    itemKey: "ice-cream-tub",
    observedQuantity: 2,
    unit: "count",
    observedAt: "2026-08-03T20:00:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
];

describe("weekly shadow consumption reconciliation composition", () => {
  it("composes planned consumption with confirmed evidence without mutation", async () => {
    const run = await runWeeklyShadowCycleWithConsumptionReconciliation(options, evidence);

    expect(run.weekly.status).toBe("COMPLETED");
    expect(run.reconciliation?.reconciliationStatus).toBe("EXCEPTIONS");
    expect(run.reconciliation?.forecast.find((item) => item.itemKey === "oats-rolled")).toMatchObject({
      expectedRemaining: 600,
      confirmedRemaining: 600,
      divergence: 0,
      status: "AGREED",
    });
    expect(run.reconciliation?.forecast.find((item) => item.itemKey === "milk-whole")).toMatchObject({
      expectedRemaining: 5,
      confirmedRemaining: 4.5,
      divergence: 0.5,
      status: "DIVERGED",
    });
    expect(run.reconciliation?.handoff.items.some((item) => item.itemKey === "milk-whole")).toBe(true);
    expect(run.weekly.mutatedHouseholdState).toBe(false);
    expect(run.weekly.appendedEvents).toBe(false);
    expect(run.weekly.dispatched).toBe(false);
    expect(run.nonMutating).toBe(true);
    expect(run.inputUnchanged).toBe(true);
    expect(run.deterministic).toBe(true);
  });

  it("keeps missing or Test provenance fail-closed in the composed reconciliation", async () => {
    const run = await runWeeklyShadowCycleWithConsumptionReconciliation(options, [
      ...evidence,
      {
        evidenceId: "EVID-TEST-IGNORED",
        itemKey: "milk-whole",
        observedQuantity: 9,
        unit: "L",
        observedAt: "2026-08-03T19:00:00.000Z",
        actor: "synthetic-household",
        source: "TEST",
        confidence: "OBSERVED",
        recordClass: "Test",
      },
      {
        evidenceId: "EVID-MISSING-PROVENANCE",
        itemKey: "milk-whole",
        observedQuantity: 9,
        unit: "L",
        observedAt: "2026-08-03T19:00:00.000Z",
        actor: "synthetic-household",
        source: "TEST",
        confidence: "OBSERVED",
      },
    ]);

    expect(run.reconciliation?.forecast.find((item) => item.itemKey === "milk-whole")?.confirmedRemaining).toBe(4.5);
    expect(run.reconciliation?.entries.some((entry) => entry.evidenceIds.includes("EVID-TEST-IGNORED"))).toBe(false);
    expect(run.reconciliation?.entries.some((entry) => entry.evidenceIds.includes("EVID-MISSING-PROVENANCE"))).toBe(false);
  });

  it("returns no reconciliation when the weekly source is refused", async () => {
    const refused = await runWeeklyShadowCycleWithConsumptionReconciliation(
      {
        ...options,
        port: createMemoryProductionPort({
          openingEvents: consumptionFixture.openingEvents ?? [],
          targets: [],
          failWith: "connector offline",
        }),
      },
      evidence,
    );

    expect(refused.weekly.status).toBe("REFUSED");
    expect(refused.reconciliation).toBeNull();
    expect(refused.inputUnchanged).toBe(true);
  });

  it("does not mutate the source fixture used to build the weekly plan", async () => {
    const before = JSON.stringify(consumptionFixture);
    await runWeeklyShadowCycleWithConsumptionReconciliation(options, evidence);
    expect(JSON.stringify(consumptionFixture)).toBe(before);
  });
});
