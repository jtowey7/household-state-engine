import { describe, expect, it } from "vitest";

import { reconcileConsumptionPlan } from "./reconciliation";
import type { ConsumptionPlan } from "./types";

const options = {
  asOf: "2026-08-15T20:00:00.000Z",
  now: () => "2026-08-15T20:00:00.000Z",
  tolerance: 0,
};

const openingStock = (itemKey: string, quantity: number, unit = "g") => ({
  eventId: `opening-${itemKey}`,
  recordClass: "Production" as const,
  eventType: "ITEM_STOCK_SET" as const,
  itemKey,
  occurredAt: "2026-08-15T08:00:00.000Z",
  payload: { quantity, unit },
});

describe("reconcileConsumptionPlan", () => {
  it("turns a completed meal into an expectation and matches confirmed evidence", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openingStock("pasta", 500)],
      meals: [
        {
          mealId: "meal-1",
          plannedFor: "2026-08-15T18:00:00.000Z",
          state: "COMPLETED",
          components: [{ itemKey: "pasta", quantity: 500, unit: "g" }],
        },
      ],
    };

    const result = reconcileConsumptionPlan(
      plan,
      [
        {
          evidenceId: "evidence-1",
          expectationId: "EXPECTED:meal-1:pasta",
          itemKey: "pasta",
          observedQuantity: 500,
          unit: "g",
          observedAt: "2026-08-15T19:00:00.000Z",
          confidence: "OBSERVED",
          recordClass: "Production",
        },
      ],
      options,
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      status: "MATCHED",
      itemKey: "pasta",
      expectedQuantity: 500,
      confirmedQuantity: 500,
      blocking: false,
    });
    expect(result.blockedItemKeys).toEqual([]);
    expect(result.handoff.items.map((item) => item.itemKey)).toContain("pasta");
  });

  it("blocks a planned item when observed consumption diverges", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openingStock("rice", 300)],
      meals: [
        {
          mealId: "meal-2",
          plannedFor: "2026-08-15T18:00:00.000Z",
          state: "COMPLETED",
          components: [{ itemKey: "rice", quantity: 300, unit: "g" }],
        },
      ],
    };

    const result = reconcileConsumptionPlan(
      plan,
      [
        {
          evidenceId: "evidence-2",
          expectationId: "EXPECTED:meal-2:rice",
          itemKey: "rice",
          observedQuantity: 150,
          unit: "g",
          observedAt: "2026-08-15T19:00:00.000Z",
          confidence: "OBSERVED",
          recordClass: "Production",
        },
      ],
      options,
    );

    expect(result.entries[0]).toMatchObject({
      status: "DIVERGED",
      itemKey: "rice",
      blocking: true,
    });
    expect(result.blockedItemKeys).toEqual(["rice"]);
    expect(result.handoff.items.map((item) => item.itemKey)).not.toContain("rice");
  });

  it("does not create expectations for skipped meals", () => {
    const plan: ConsumptionPlan = {
      meals: [
        {
          mealId: "meal-3",
          plannedFor: "2026-08-15T18:00:00.000Z",
          state: "SKIPPED",
          components: [{ itemKey: "beans", quantity: 250, unit: "g" }],
        },
      ],
    };

    const result = reconcileConsumptionPlan(plan, [], options);

    expect(result.entries).toEqual([]);
    expect(result.expectedEvents).toEqual([]);
    expect(result.blockedItemKeys).toEqual([]);
  });

  it("keeps repeated reconciliation deterministic", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openingStock("beans", 250)],
      meals: [
        {
          mealId: "meal-4",
          plannedFor: "2026-08-15T18:00:00.000Z",
          state: "COMPLETED",
          components: [{ itemKey: "beans", quantity: 250, unit: "g" }],
        },
      ],
    };
    const evidence = [
      {
        evidenceId: "evidence-4",
        expectationId: "EXPECTED:meal-4:beans",
        itemKey: "beans",
        observedQuantity: 250,
        unit: "g",
        observedAt: "2026-08-15T19:00:00.000Z",
        confidence: "REPORTED" as const,
        recordClass: "Production" as const,
      },
    ];

    const first = reconcileConsumptionPlan(plan, evidence, options);
    const second = reconcileConsumptionPlan(plan, evidence, options);

    expect(second).toEqual(first);
  });
});
