import { describe, expect, it } from "vitest";
import { projectConsumptionEvents, runConsumptionCycle } from "./projector";
import { consumptionAsOf, consumptionFixture } from "./fixtures";
import type { ConsumptionPlan, PlannedMeal } from "./types";
import { replayEvents } from "../state-engine";

const NOW = () => "2026-01-01T00:00:00.000Z";
const AS_OF = "2026-08-03T20:00:00.000Z";

const openStock = (itemKey: string, quantity: number, unit: string) => ({
  eventId: `OPEN-${itemKey}`,
  recordClass: "Production" as const,
  eventType: "ITEM_STOCK_SET" as const,
  itemKey,
  occurredAt: "2026-08-01T00:00:00.000Z",
  payload: { quantity, unit },
});

const meal = (o: Partial<PlannedMeal> & { mealId: string }): PlannedMeal => ({
  plannedFor: "2026-08-02T08:00:00.000Z",
  state: "COMPLETED",
  components: [{ itemKey: "oats-rolled", quantity: 300, unit: "g" }],
  ...o,
});

const qty = (plan: ConsumptionPlan, itemKey: string) =>
  runConsumptionCycle(plan, { asOf: AS_OF, now: NOW }).snapshot.items.find(
    (i) => i.itemKey === itemKey,
  )?.quantity;

describe("planned meal consumption", () => {
  it("burns the planned household quantity without portion reporting", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [meal({ mealId: "M1" })],
    };
    expect(qty(plan, "oats-rolled")).toBe(700);
  });

  it("assumes consumption once a DUE meal's date has passed", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [meal({ mealId: "M1", state: "DUE" })],
    };
    expect(qty(plan, "oats-rolled")).toBe(700);
  });

  it("does not burn a meal that is not yet due", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [meal({ mealId: "M1", state: "DUE", plannedFor: "2026-09-01T08:00:00.000Z" })],
    };
    expect(qty(plan, "oats-rolled")).toBe(1000);
  });
});

describe("duplicate completion", () => {
  it("does not double-decrement when a completion is delivered twice", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [meal({ mealId: "M1" }), meal({ mealId: "M1" })],
    };
    const cycle = runConsumptionCycle(plan, { asOf: AS_OF, now: NOW });
    expect(cycle.snapshot.items[0]!.quantity).toBe(700);
    expect(cycle.snapshot.exceptions.map((x) => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
    expect(cycle.snapshot.reconciliationStatus).toBe("EXCEPTIONS");
  });
});

describe("skipped / changed meals", () => {
  it("does not decrement merely because the calendar date changed", () => {
    for (const state of ["SKIPPED", "CHANGED"] as const) {
      const plan: ConsumptionPlan = {
        openingEvents: [openStock("oats-rolled", 1000, "g")],
        meals: [meal({ mealId: "M1", state })],
      };
      expect(qty(plan, "oats-rolled")).toBe(1000);
    }
  });
});

describe("daily allocation burn-down", () => {
  it("burns per person per day up to the evaluation date only", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("ice-cream-tub", 20, "count")],
      allocations: [
        {
          allocationId: "A1",
          itemKey: "ice-cream-tub",
          quantityPerPersonPerDay: 1,
          unit: "count",
          people: 2,
          startDate: "2026-08-01",
          endDate: "2026-08-07",
        },
      ],
    };
    // 2026-08-01..03 inclusive = 3 days × 2 people = 6.
    expect(qty(plan, "ice-cream-tub")).toBe(14);
  });
});

describe("durable stock", () => {
  it("is not auto-burned without a plan or exception demanding it", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("rice-basmati", 5000, "g")],
      meals: [meal({ mealId: "M1" })],
    };
    expect(qty(plan, "rice-basmati")).toBe(5000);
  });
});

describe("unplanned consumption exception", () => {
  it("burns via a reported exception event, not a manual inventory edit", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("milk-whole", 6, "L")],
      exceptions: [
        {
          exceptionId: "X1",
          type: "UNPLANNED_CONSUMPTION",
          itemKey: "milk-whole",
          quantity: 0.5,
          unit: "L",
          occurredAt: "2026-08-02T21:00:00.000Z",
        },
      ],
    };
    const cycle = runConsumptionCycle(plan, { asOf: AS_OF, now: NOW });
    expect(cycle.snapshot.items[0]!.quantity).toBe(5.5);
    expect(cycle.snapshot.items[0]!.contributingEventIds).toEqual(["OPEN-milk-whole", "EXC:X1"]);
  });

  it("NOT_CONSUMED suppresses the planned burn for that item only", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g"), openStock("milk-whole", 6, "L")],
      meals: [
        meal({
          mealId: "M1",
          components: [
            { itemKey: "oats-rolled", quantity: 300, unit: "g" },
            { itemKey: "milk-whole", quantity: 1, unit: "L" },
          ],
        }),
      ],
      exceptions: [
        {
          exceptionId: "X2",
          type: "NOT_CONSUMED",
          itemKey: "oats-rolled",
          mealId: "M1",
          occurredAt: "2026-08-02T10:00:00.000Z",
        },
      ],
    };
    expect(qty(plan, "oats-rolled")).toBe(1000);
    expect(qty(plan, "milk-whole")).toBe(5);
  });
});

describe("leftovers", () => {
  it("creates no leftover inventory unless leftovers were explicitly planned", () => {
    const withoutPlanned: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [meal({ mealId: "M1" })],
    };
    const cycle = runConsumptionCycle(withoutPlanned, { asOf: AS_OF, now: NOW });
    expect(cycle.snapshot.items.map((i) => i.itemKey)).toEqual(["oats-rolled"]);

    const withPlanned: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g")],
      meals: [
        meal({
          mealId: "M1",
          plannedLeftovers: [{ itemKey: "porridge-leftover", quantity: 1, unit: "portion" }],
        }),
      ],
    };
    expect(qty(withPlanned, "porridge-leftover")).toBe(1);
  });
});

describe("uncertainty isolation", () => {
  it("isolates the uncertain item and lets unrelated planning continue", () => {
    const plan: ConsumptionPlan = {
      openingEvents: [openStock("oats-rolled", 1000, "g"), openStock("milk-whole", 6, "L")],
      exceptions: [
        {
          exceptionId: "X3",
          type: "UNCERTAIN_QUANTITY",
          itemKey: "milk-whole",
          occurredAt: "2026-08-03T10:00:00.000Z",
        },
      ],
    };
    const cycle = runConsumptionCycle(plan, { asOf: AS_OF, now: NOW });
    expect(cycle.projection.uncertainItemKeys).toEqual(["milk-whole"]);
    expect(cycle.handoff.items.map((i) => i.itemKey)).toEqual(["oats-rolled"]);
    expect(cycle.handoff.blockedItemKeys).toEqual(["milk-whole"]);
    // Provenance for the isolated item is preserved in the snapshot.
    expect(
      cycle.snapshot.items.find((i) => i.itemKey === "milk-whole")!.contributingEventIds,
    ).toEqual(["OPEN-milk-whole"]);
  });

  it("keeps a payload conflict blocking only its own item", () => {
    const events = projectConsumptionEvents(consumptionFixture, {
      asOf: consumptionAsOf,
    }).events;
    const conflicted = replayEvents(
      [
        ...events,
        {
          ...events[0]!,
          payload: { ...events[0]!.payload, quantity: 999 },
        },
      ],
      { now: NOW },
    );
    expect(conflicted.reconciliationStatus).toBe("BLOCKED");
    expect(conflicted.blockedItemKeys).toEqual([events[0]!.itemKey]);
  });
});

describe("replay determinism", () => {
  it("projects and replays identically across runs", () => {
    const a = runConsumptionCycle(consumptionFixture, { asOf: consumptionAsOf, now: NOW });
    const b = runConsumptionCycle(consumptionFixture, { asOf: consumptionAsOf, now: NOW });
    expect(a).toEqual(b);
    expect(a.snapshot.snapshotId).toBe(b.snapshot.snapshotId);
    expect(a.projection.events.map((e) => e.eventId)).toEqual(
      b.projection.events.map((e) => e.eventId),
    );
  });
});
