import { createRuntimeHouseholdTestDb } from "../runtime-household-test-double";
import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition, type ReconciledDelivery } from "./delivery-inventory";
import { appendTestHouseholdEvent, readTestHouseholdState } from "../runtime-household";
import type { HouseholdEvent } from "./types";


/** Minimal in-memory D1 test double: no network, Airtable or Production state. */

function asTestRuntimeEvent(event: HouseholdEvent): HouseholdEvent {
  return { ...event, recordClass: "Test" };
}

const delivery: ReconciledDelivery = {
  deliveryId: "delivery-family-alpha-2026-08-30",
  dispatchId: "dispatch-family-alpha-2026-08-30",
  basketId: "basket-family-alpha-2026-08-30",
  basketVersion: 3,
  basketFingerprint: "basket-fingerprint-family-alpha-2026-08-30",
  deliveredAt: "2026-08-30T18:45:00Z",
  reconciliationStatus: "RECONCILED",
  lines: [
    { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
    { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

describe("delivery -> TEST runtime -> materialised inventory", () => {
  it("composes the canonical delivery transition with the existing runtime adapter", async () => {
    const db = createRuntimeHouseholdTestDb();
    const opening: HouseholdEvent = {
      eventId: "opening-chicken",
      recordClass: "Test",
      eventType: "ITEM_STOCK_SET",
      itemKey: "Chicken breast",
      occurredAt: "2026-08-29T09:00:00Z",
      payload: { quantity: 1, unit: "packs", evidencePrecision: "EXACT" },
    };

    await appendTestHouseholdEvent(db, opening);
    const transition = buildDeliveryInventoryTransition(delivery);

    for (const event of transition.events) {
      const result = await appendTestHouseholdEvent(db, asTestRuntimeEvent(event));
      expect(result.conflict).toBe(false);
      expect(result.appended).toBe(true);
    }

    const state = await readTestHouseholdState(db);
    expect(state.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(state.snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemKey: "Chicken breast", quantity: 3, unit: "packs" }),
        expect.objectContaining({ itemKey: "Limes", quantity: 1, unit: "each" }),
      ]),
    );
    expect(state.snapshot.items.find((item) => item.itemKey === "Limes")?.contributingEventIds).toHaveLength(1);
  });

  it("preserves substitution provenance and is idempotent on a repeated delivery", async () => {
    const db = createRuntimeHouseholdTestDb();
    const transition = buildDeliveryInventoryTransition(delivery);
    const runtimeEvents = transition.events.map(asTestRuntimeEvent);

    for (const event of runtimeEvents) await appendTestHouseholdEvent(db, event);
    const repeated = await Promise.all(runtimeEvents.map((event) => appendTestHouseholdEvent(db, event)));

    expect(repeated.every((result) => result.duplicate && !result.conflict && !result.appended)).toBe(true);
    expect(db.events).toHaveLength(runtimeEvents.length);

    const state = await readTestHouseholdState(db);
    const limes = state.snapshot.items.find((item) => item.itemKey === "Limes");
    expect(limes?.quantity).toBe(1);
    expect(limes?.contributingEventIds).toEqual([runtimeEvents.find((event) => event.itemKey === "Limes")!.eventId]);
  });

  it("fails closed when the same delivery event identity is reused with different content", async () => {
    const db = createRuntimeHouseholdTestDb();
    const event = asTestRuntimeEvent(buildDeliveryInventoryTransition(delivery).events[0]!);
    await appendTestHouseholdEvent(db, event);

    const conflicting = await appendTestHouseholdEvent(db, {
      ...event,
      payload: { ...event.payload, quantity: (event.payload.quantity ?? 0) + 1 },
    });

    expect(conflicting.appended).toBe(false);
    expect(conflicting.conflict).toBe(true);
    expect(conflicting.snapshot.reconciliationStatus).toBe("BLOCKED");
    expect(db.events).toHaveLength(1);
  });
});
