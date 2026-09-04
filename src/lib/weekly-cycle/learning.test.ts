import { describe, expect, it } from "vitest";

import type { ConsumptionEvidence } from "../expected-state";
import { createMemoryProductionPort } from "../production-adapter";
import {
  runWeeklyShadowCycleWithLearning,
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
    observedQuantity: 0.5,
    unit: "L",
    observedAt: "2026-08-02T08:30:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
  {
    evidenceId: "EVID-MEAL-3002-MILK",
    expectationId: "EXPECTED:MEAL-3002:milk-whole",
    itemKey: "milk-whole",
    observedQuantity: 0.5,
    unit: "L",
    observedAt: "2026-08-03T08:30:00.000Z",
    actor: "synthetic-household",
    source: "TEST",
    confidence: "OBSERVED",
    recordClass: "Production",
  },
];

describe("weekly shadow governed learning composition", () => {
  it("feeds the existing reconciliation result into proposal-only learning", async () => {
    const run = await runWeeklyShadowCycleWithLearning(options, evidence);

    expect(run.weekly.reconciliation).not.toBeNull();
    expect(run.learning).not.toBeNull();
    expect(run.learning?.proposalOnly).toBe(true);
    expect(run.learning?.mutatedHouseholdState).toBe(false);
    expect(run.learning?.promoted).toBe(false);
    expect(run.learning?.observations.length).toBeGreaterThan(0);
    expect(run.deterministic).toBe(true);
    expect(run.nonMutating).toBe(true);
    expect(run.proposalOnly).toBe(true);
  });

  it("does not invent learning when the authoritative weekly source is refused", async () => {
    const run = await runWeeklyShadowCycleWithLearning(
      {
        ...options,
        port: createMemoryProductionPort({
          openingEvents: [],
          targets: [],
          failWith: "connector offline",
        }),
      },
      evidence,
    );

    expect(run.weekly.weekly.status).toBe("REFUSED");
    expect(run.learning).toBeNull();
    expect(run.proposalOnly).toBe(true);
  });
});
