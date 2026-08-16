import { describe, expect, it } from "vitest";
import { runConsumptionCycle } from "./projector";
import type { ConsumptionPlan } from "./types";

const AS_OF = "2026-08-03T20:00:00.000Z";
const NOW = () => "2026-08-03T20:00:00.000Z";

const opening = {
  eventId: "OPEN-PASTA",
  recordClass: "Production" as const,
  eventType: "ITEM_STOCK_SET" as const,
  itemKey: "pasta",
  occurredAt: "2026-08-01T08:00:00.000Z",
  payload: { quantity: 1000, unit: "g" },
};

describe("partial consumption correction", () => {
  it("burns the confirmed partial quantity and preserves the exception provenance", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [opening],
      meals: [
        {
          mealId: "MEAL-PASTA-1",
          plannedFor: "2026-08-02T18:00:00.000Z",
          state: "COMPLETED",
          components: [{ itemKey: "pasta", quantity: 300, unit: "g" }],
        },
      ],
      exceptions: [
        {
          exceptionId: "PARTIAL-PASTA-1",
          type: "PARTIAL_CONSUMPTION",
          itemKey: "pasta",
          mealId: "MEAL-PASTA-1",
          quantity: 180,
          unit: "g",
          occurredAt: "2026-08-02T20:00:00.000Z",
          note: "synthetic correction: only 180g confirmed consumed",
        },
      ],
    };

    const cycle = runConsumptionCycle(plan, { asOf: AS_OF, now: NOW });
    const pasta = cycle.snapshot.items.find((item) => item.itemKey === "pasta");

    expect(pasta).toEqual(
      expect.objectContaining({
        quantity: 820,
        unit: "g",
        blocked: false,
        contributingEventIds: ["OPEN-PASTA", "CONSUME:MEAL-PASTA-1:pasta"],
      }),
    );
    expect(cycle.projection.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MEAL_OVERRIDDEN_BY_EXCEPTION",
          sourceId: "PARTIAL-PASTA-1",
          itemKey: "pasta",
        }),
      ]),
    );
    expect(cycle.projection.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "CONSUME:MEAL-PASTA-1:pasta",
          payload: expect.objectContaining({ quantity: -180, unit: "g" }),
        }),
      ]),
    );
  });
});
