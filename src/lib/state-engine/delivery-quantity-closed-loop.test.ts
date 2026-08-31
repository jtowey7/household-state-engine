import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition } from "./delivery-inventory";
import { replayEvents } from "./engine";
import type { HouseholdEvent } from "./types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import type { DemandTarget } from "../quantity-adapter/types";

const now = () => "2026-08-31T08:00:00.000Z";

/** Synthetic opening stock only — no Production household data is read. */
const openingStock: HouseholdEvent[] = [
  {
    eventId: "OPENING-CHICKEN",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "Chicken breast",
    occurredAt: "2026-08-29T09:00:00Z",
    payload: { quantity: 1, unit: "packs", evidencePrecision: "EXACT" },
  },
];

const delivery = {
  deliveryId: "delivery-family-alpha-2026-08-30",
  deliveredAt: "2026-08-30T18:45:00Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
    { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each" },
  ],
};

/** Fixed demand plan held constant across both quantity runs. */
const targets: readonly DemandTarget[] = [
  { itemKey: "Chicken breast", targetQuantity: 4, unit: "packs" },
  { itemKey: "Limes", targetQuantity: 1, unit: "each" },
];

function runQuantity(events: HouseholdEvent[]) {
  return adaptSnapshotToQuantityRun(replayEvents(events, { now }), { targets });
}

describe("closed loop: delivery -> replay -> next quantity run", () => {
  const transition = buildDeliveryInventoryTransition(delivery);
  const before = runQuantity([...openingStock]);
  const after = runQuantity([...openingStock, ...transition.events]);

  it("both runs execute against a clean replay", () => {
    expect(before.executed).toBe(true);
    expect(after.executed).toBe(true);
    expect(before.reconciliationStatus).toBe("CLEAN");
    expect(after.reconciliationStatus).toBe("CLEAN");
  });

  it("reduces the fixed demand target by exactly the delivered quantity", () => {
    const chickenBefore = before.requirements.find((r) => r.itemKey === "Chicken breast");
    const chickenAfter = after.requirements.find((r) => r.itemKey === "Chicken breast");

    expect(chickenBefore?.onHandQuantity).toBe(1);
    expect(chickenBefore?.requiredQuantity).toBe(3);
    expect(chickenAfter?.onHandQuantity).toBe(3);
    expect(chickenAfter?.requiredQuantity).toBe(1);
    expect(chickenBefore!.requiredQuantity - chickenAfter!.requiredQuantity).toBe(2);
    // The demand target itself is untouched by delivery.
    expect(chickenAfter?.targetQuantity).toBe(4);
  });

  it("drops to zero requirement where the delivery fully covers the target", () => {
    const limesBefore = before.requirements.find((r) => r.itemKey === "Limes");
    expect(limesBefore?.requiredQuantity).toBe(1);
    expect(after.requirements.some((r) => r.itemKey === "Limes")).toBe(false);
    expect(after.rejections.some((r) => r.itemKey === "Limes" && r.fatal)).toBe(false);
  });

  it("preserves snapshot/replay provenance and delivery event IDs into the next run", () => {
    const snapshot = replayEvents([...openingStock, ...transition.events], { now });
    expect(after.snapshotId).toBe(snapshot.snapshotId);
    expect(after.replayId).toBe(snapshot.replayId);
    expect(after.replayTimestamp).toBe(snapshot.replayTimestamp);
    expect(after.snapshotId).not.toBe(before.snapshotId);

    const deliveryEventId = transition.events.find((e) => e.itemKey === "Chicken breast")!.eventId;
    expect(deliveryEventId.startsWith("DELIVERY:")).toBe(true);
    const chickenAfter = after.requirements.find((r) => r.itemKey === "Chicken breast");
    expect(chickenAfter?.sourceEventIds).toContain(deliveryEventId);
    expect(chickenAfter?.sourceEventIds).toContain("OPENING-CHICKEN");
  });

  it("is deterministic and idempotent when the same delivery is replayed twice", () => {
    const twice = runQuantity([
      ...openingStock,
      ...transition.events,
      ...buildDeliveryInventoryTransition(delivery).events,
    ]);
    expect(twice.planId).toBe(after.planId);
    expect(twice.requirements).toEqual(after.requirements);
  });
});
