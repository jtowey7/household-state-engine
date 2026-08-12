import type { ConsumptionPlan } from "./types";
import type { HouseholdEvent } from "../state-engine/types";

/** SYNTHETIC ONLY — no real household production data. */
export const consumptionAsOf = "2026-08-03T20:00:00.000Z";

const openingEvents: HouseholdEvent[] = [
  {
    eventId: "OPEN-OATS",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 1200, unit: "g", note: "synthetic opening balance" },
  },
  {
    eventId: "OPEN-MILK",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "milk-whole",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 6, unit: "L", note: "synthetic opening balance" },
  },
  {
    eventId: "OPEN-ICECREAM",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "ice-cream-tub",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 20, unit: "count", note: "synthetic opening balance" },
  },
  {
    eventId: "OPEN-RICE",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "rice-basmati",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 5000, unit: "g", note: "durable cupboard stock" },
  },
];

export const consumptionFixture: ConsumptionPlan = {
  openingEvents,
  meals: [
    {
      mealId: "MEAL-3001",
      plannedFor: "2026-08-02T08:00:00.000Z",
      state: "COMPLETED",
      components: [
        { itemKey: "oats-rolled", quantity: 300, unit: "g" },
        { itemKey: "milk-whole", quantity: 1, unit: "L" },
      ],
    },
    {
      mealId: "MEAL-3002",
      plannedFor: "2026-08-03T08:00:00.000Z",
      state: "DUE",
      components: [{ itemKey: "oats-rolled", quantity: 300, unit: "g" }],
    },
    {
      mealId: "MEAL-3003",
      plannedFor: "2026-08-03T18:00:00.000Z",
      state: "SKIPPED",
      components: [{ itemKey: "rice-basmati", quantity: 500, unit: "g" }],
    },
    {
      mealId: "MEAL-3004",
      plannedFor: "2026-08-09T18:00:00.000Z",
      state: "PLANNED",
      components: [{ itemKey: "rice-basmati", quantity: 500, unit: "g" }],
    },
  ],
  allocations: [
    {
      allocationId: "ALLOC-ICE",
      itemKey: "ice-cream-tub",
      quantityPerPersonPerDay: 1,
      unit: "count",
      people: 2,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    },
  ],
  exceptions: [
    {
      exceptionId: "EXC-7001",
      type: "UNPLANNED_CONSUMPTION",
      itemKey: "milk-whole",
      quantity: 0.5,
      unit: "L",
      occurredAt: "2026-08-02T21:00:00.000Z",
      note: "synthetic unplanned consumption",
    },
  ],
};
