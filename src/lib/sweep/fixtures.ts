/**
 * Food OS — Quick Stock Sweep / Tell Food OS interaction slice.
 *
 * SYNTHETIC DEMO FIXTURES ONLY. Nothing here touches Airtable, a household
 * database or any production record. These are illustration quantities used to
 * make the expected-vs-confirmed model legible in the UI.
 */

import type { HouseholdEvent } from "../state-engine/types";
import type { ExpectedConsumption } from "../expected-state/types";

export const SWEEP_AS_OF = "2026-02-10T19:00:00.000Z";

export interface SweepItemFixture {
  itemKey: string;
  label: string;
  unit: string;
  /** Synthetic opening on-hand quantity. */
  openingQuantity: number;
  /** Plain-language reason the plan expects this to burn down. */
  expectedBecause: string;
  /** What this example is here to demonstrate. */
  teaches: string;
}

export const SWEEP_ITEMS: readonly SweepItemFixture[] = [
  {
    itemKey: "salmon-fillet",
    label: "Salmon fillet",
    unit: "g",
    openingQuantity: 780,
    expectedBecause: "Tuesday roast salmon was marked cooked",
    teaches: "Expected consumption versus what you actually confirm.",
  },
  {
    itemKey: "gem-lettuce",
    label: "Gem lettuce",
    unit: "g",
    openingQuantity: 220,
    expectedBecause: "Thursday side salad — not due yet",
    teaches: "Waste risk: still expected, nothing confirmed.",
  },
  {
    itemKey: "haribo",
    label: "Haribo",
    unit: "g",
    openingQuantity: 300,
    expectedBecause: "Snack allocation burns down daily",
    teaches: "Fast burn-down against a small allocation.",
  },
] as const;

/** Synthetic opening balances, as ordinary household events. */
export const sweepOpeningEvents: readonly HouseholdEvent[] = SWEEP_ITEMS.map((item) => ({
  eventId: `DEMO-OPENING:${item.itemKey}`,
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: item.itemKey,
  occurredAt: "2026-02-09T08:00:00.000Z",
  payload: { quantity: item.openingQuantity, unit: item.unit, note: "synthetic opening balance" },
}));

/** Synthetic plan-derived expectations (planning intent, never observed truth). */
export const sweepExpectations: readonly ExpectedConsumption[] = [
  {
    expectationId: "EXP-SALMON-TUE",
    itemKey: "salmon-fillet",
    quantity: 780,
    unit: "g",
    expectedAt: "2026-02-10T18:00:00.000Z",
    sourceId: "MEAL:tue-roast-salmon",
  },
  {
    expectationId: "EXP-LETTUCE-THU",
    itemKey: "gem-lettuce",
    quantity: 120,
    unit: "g",
    expectedAt: "2026-02-12T18:00:00.000Z",
    sourceId: "MEAL:thu-side-salad",
  },
  {
    expectationId: "EXP-HARIBO-DAILY",
    itemKey: "haribo",
    quantity: 60,
    unit: "g",
    expectedAt: "2026-02-10T16:00:00.000Z",
    sourceId: "ALLOCATION:snacks-daily",
  },
];

export function fixtureForItem(itemKey: string): SweepItemFixture | undefined {
  return SWEEP_ITEMS.find((i) => i.itemKey === itemKey);
}

export function expectationForItem(itemKey: string): ExpectedConsumption | undefined {
  return sweepExpectations.find((x) => x.itemKey === itemKey);
}
