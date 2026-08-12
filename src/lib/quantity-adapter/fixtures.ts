import type { DemandTarget } from "./types";
import type { HouseholdEvent } from "../state-engine/types";

/** SYNTHETIC demand targets only — no real household or Airtable data. */
export const shadowTargets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" },
  { itemKey: "eggs-large", targetQuantity: 12, unit: "count", packSize: 6, packUnit: "count" },
  { itemKey: "rice-basmati", targetQuantity: 5000, unit: "g", packSize: 1000, packUnit: "g" },
  { itemKey: "flour-plain", targetQuantity: 2000, unit: "g", packSize: 1500, packUnit: "g" },
  { itemKey: "coffee-beans", targetQuantity: 1000, unit: "g", packSize: 250, packUnit: "g" },
];

/** Synthetic stream exercising consolidation of repeated deltas on one item. */
export const shadowConsolidationEvents: HouseholdEvent[] = [
  {
    eventId: "EVT-9001",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "eggs-large",
    occurredAt: "2026-08-06T08:00:00.000Z",
    payload: { quantity: 2, unit: "count" },
  },
  {
    eventId: "EVT-9002",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "eggs-large",
    occurredAt: "2026-08-06T09:00:00.000Z",
    payload: { quantity: 3, unit: "count" },
  },
];
