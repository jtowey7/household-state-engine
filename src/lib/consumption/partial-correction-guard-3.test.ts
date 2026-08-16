import { describe, expect, it } from "vitest";
import { runConsumptionCycle } from "./projector";

describe("partial consumption correction", () => {
  it("uses the confirmed partial quantity instead of the planned quantity", () => {
    const cycle = runConsumptionCycle({ openingEvents: [{ eventId: "OPEN-PASTA", recordClass: "Production", eventType: "ITEM_STOCK_SET", itemKey: "pasta", occurredAt: "2026-08-01T08:00:00.000Z", payload: { quantity: 1000, unit: "g" } }], meals: [{ mealId: "MEAL-PASTA-1", plannedFor: "2026-08-02T18:00:00.000Z", state: "COMPLETED", components: [{ itemKey: "pasta", quantity: 300, unit: "g" }] }], exceptions: [{ exceptionId: "PARTIAL-PASTA-1", type: "PARTIAL_CONSUMPTION", itemKey: "pasta", mealId: "MEAL-PASTA-1", quantity: 180, unit: "g", occurredAt: "2026-08-02T20:00:00.000Z" }] }, { asOf: "2026-08-03T20:00:00.000Z", now: () => "2026-08-03T20:00:00.000Z" });
    expect(cycle.snapshot.items.find((item) => item.itemKey === "pasta")).toEqual(expect.objectContaining({ quantity: 820, blocked: false }));
  });
});
