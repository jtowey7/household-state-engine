import { describe, expect, it } from "vitest";

import { projectConsumptionEvents } from "./projector";
import { replayEvents } from "../state-engine/engine";

const fixedNow = { now: () => "1970-01-01T00:00:00.000Z" };

describe("red-team: duplicate component lines within one meal", () => {
  const plan = {
    meals: [
      {
        mealId: "MEAL-DUP",
        plannedFor: "2026-08-11T19:00:00.000Z",
        state: "COMPLETED" as const,
        components: [
          { itemKey: "salmon-fillets", quantity: 390, unit: "g" },
          { itemKey: "salmon-fillets", quantity: 390, unit: "g" },
          { itemKey: "rice-basmati", quantity: 200, unit: "g" },
        ],
      },
    ],
  };

  it("aggregates repeated item lines into a single deterministic event", () => {
    const projection = projectConsumptionEvents(plan, { asOf: "2026-08-12T00:00:00.000Z" });
    const salmon = projection.events.filter((e) => e.itemKey === "salmon-fillets");
    expect(salmon).toHaveLength(1);
    expect(salmon[0]?.payload.quantity).toBe(-780);
    expect(new Set(projection.events.map((e) => e.eventId)).size).toBe(
      projection.events.length,
    );
  });

  it("does not manufacture a reused-Event-ID payload conflict", () => {
    const snapshot = replayEvents(
      projectConsumptionEvents(plan, { asOf: "2026-08-12T00:00:00.000Z" }).events,
      fixedNow,
    );
    // Only the (expected) negative-stock isolation appears — no integrity conflict.
    expect(snapshot.exceptions.map((e) => e.code)).toEqual([
      "NEGATIVE_STOCK_ISOLATED",
      "NEGATIVE_STOCK_ISOLATED",
    ]);
    expect(snapshot.exceptions.some((e) => e.blocking)).toBe(false);
    expect(snapshot.reconciliationStatus).toBe("EXCEPTIONS");
    expect(snapshot.items.find((i) => i.itemKey === "salmon-fillets")?.quantity).toBe(-780);
  });


  it("keeps distinct units separate rather than silently summing them", () => {
    const projection = projectConsumptionEvents(
      {
        meals: [
          {
            mealId: "MEAL-UNITS",
            plannedFor: "2026-08-11T19:00:00.000Z",
            state: "COMPLETED",
            components: [
              { itemKey: "milk-whole", quantity: 200, unit: "ml" },
              { itemKey: "milk-whole", quantity: 1, unit: "l" },
            ],
          },
        ],
      },
      { asOf: "2026-08-12T00:00:00.000Z" },
    );
    const units = projection.events.map((e) => e.payload.unit);
    expect(new Set(units)).toEqual(new Set(["ml", "l"]));
  });
});
