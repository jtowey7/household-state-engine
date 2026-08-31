/**
 * FoodOS household view model — reconciled delivery → household stock.
 *
 * PRESENTATION ONLY, ISOLATED/SYNTHETIC DATA ONLY.
 *
 * This module runs the existing, already-proven state-engine seam
 * (buildDeliveryInventoryTransition -> replayEvents) over a synthetic
 * reconciled delivery so the household surface can show, in plain language,
 * what a reconciled delivery did to on-hand stock. It reads no Production
 * household data, performs no writes, and changes no engine behaviour.
 */

import { buildDeliveryInventoryTransition } from "../state-engine/delivery-inventory";
import { replayEvents } from "../state-engine/engine";
import type { HouseholdEvent } from "../state-engine/types";

const NOW = () => "2026-08-31T08:00:00.000Z";

const openingEvents: HouseholdEvent[] = [
  {
    eventId: "DEMO-OPENING-CHICKEN",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "Chicken breast",
    occurredAt: "2026-08-29T09:00:00Z",
    payload: { quantity: 1, unit: "packs", evidencePrecision: "EXACT" },
  },
  {
    eventId: "DEMO-OPENING-MILK",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "Whole milk",
    occurredAt: "2026-08-29T09:00:00Z",
    payload: { quantity: 1, unit: "litres", evidencePrecision: "EXACT" },
  },
];

const demoDelivery = {
  deliveryId: "demo-delivery-2026-08-30",
  deliveredAt: "2026-08-30T18:45:00Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    { lineId: "demo-line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
    { lineId: "demo-line-milk", itemKey: "Whole milk", deliveredQuantity: 4, unit: "litres" },
    { lineId: "demo-line-limes", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

export interface DeliveryStockLine {
  itemKey: string;
  label: string;
  unit: string;
  delivered: number;
  before: number;
  after: number;
  substituted: boolean;
}

export interface DeliveryStockView {
  deliveredAt: string;
  lineCount: number;
  /** True only when the replayed post-delivery state has no unresolved conflicts. */
  settled: boolean;
  lines: readonly DeliveryStockLine[];
}

function buildView(): DeliveryStockView {
  const transition = buildDeliveryInventoryTransition(demoDelivery);
  const before = replayEvents(openingEvents, { now: NOW });
  const after = replayEvents([...openingEvents, ...transition.events], { now: NOW });

  const lines = demoDelivery.lines.map((line) => {
    const beforeItem = before.items.find((item) => item.itemKey === line.itemKey);
    const afterItem = after.items.find((item) => item.itemKey === line.itemKey);
    return {
      itemKey: line.itemKey,
      label: line.itemKey,
      unit: line.unit,
      delivered: line.deliveredQuantity,
      before: beforeItem?.quantity ?? 0,
      after: afterItem?.quantity ?? line.deliveredQuantity,
      substituted: line.substituted === true,
    };
  });

  return {
    deliveredAt: demoDelivery.deliveredAt,
    lineCount: lines.length,
    settled: after.reconciliationStatus === "CLEAN" && after.blockedItemKeys.length === 0,
    lines,
  };
}

export const deliveryStockView: DeliveryStockView = buildView();
