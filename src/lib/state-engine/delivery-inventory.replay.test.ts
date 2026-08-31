import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition } from "./delivery-inventory";
import { replayEvents, toQuantityRequirementsHandoff } from "./engine";
import type { HouseholdEvent } from "./types";

const now = () => "2026-08-31T08:00:00.000Z";

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
    { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

describe("reconciled delivery -> replay -> materialised inventory", () => {
  it("increases on-hand stock for delivered items without inventing unordered stock", () => {
    const transition = buildDeliveryInventoryTransition(delivery);
    const snapshot = replayEvents([...openingStock, ...transition.events], { now });

    const chicken = snapshot.items.find((item) => item.itemKey === "Chicken breast");
    const limes = snapshot.items.find((item) => item.itemKey === "Limes");

    expect(chicken?.quantity).toBe(3);
    expect(chicken?.unit).toBe("packs");
    expect(limes?.quantity).toBe(1);
    expect(snapshot.items.some((item) => item.itemKey === "Lemons")).toBe(false);
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
  });

  it("preserves delivery provenance on the materialised item", () => {
    const transition = buildDeliveryInventoryTransition(delivery);
    const snapshot = replayEvents([...openingStock, ...transition.events], { now });
    const chicken = snapshot.items.find((item) => item.itemKey === "Chicken breast");

    const deliveryEventId = transition.events.find((event) => event.itemKey === "Chicken breast")!.eventId;
    expect(deliveryEventId.startsWith("DELIVERY:")).toBe(true);
    expect(chicken?.contributingEventIds).toContain(deliveryEventId);
    expect(snapshot.contributingEventIds).toContain(deliveryEventId);
  });

  it("is idempotent when the same reconciled delivery is replayed twice", () => {
    const transition = buildDeliveryInventoryTransition(delivery);
    const once = replayEvents([...openingStock, ...transition.events], { now });
    const twice = replayEvents(
      [...openingStock, ...transition.events, ...buildDeliveryInventoryTransition(delivery).events],
      { now },
    );

    expect(twice.items).toEqual(once.items);
    expect(twice.snapshotId).toBe(once.snapshotId);
    expect(twice.replayId).toBe(once.replayId);
  });

  it("hands the post-delivery inventory off to QUANTITY REQUIREMENTS", () => {
    const transition = buildDeliveryInventoryTransition(delivery);
    const handoff = toQuantityRequirementsHandoff(
      replayEvents([...openingStock, ...transition.events], { now }),
    );

    expect(handoff.readyForQuantityRun).toBe(true);
    expect(handoff.blockedItemKeys).toEqual([]);
    const chicken = handoff.items.find((item) => item.itemKey === "Chicken breast");
    expect(chicken?.quantity).toBe(3);
    expect(chicken?.sourceEventIds).toContain(
      transition.events.find((event) => event.itemKey === "Chicken breast")!.eventId,
    );
  });
});
