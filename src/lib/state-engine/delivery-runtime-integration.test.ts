import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition, type ReconciledDelivery } from "./delivery-inventory";
import { appendTestHouseholdEvent, readTestHouseholdState } from "../runtime-household";
import type { HouseholdEvent } from "./types";

type Row = Record<string, unknown>;

/** Minimal in-memory D1 test double: no network, Airtable or Production state. */
function fakeDb() {
  const events: Array<Row & { sequence: number }> = [];
  const snapshots = new Map<string, Row>();
  let sequence = 0;

  return {
    events,
    snapshots,
    prepare(sql: string) {
      const bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings.push(...values);
          return this;
        },
        async all() {
          if (sql.includes("FROM runtime_household_events") && sql.includes("event_hash")) {
            return {
              results: events
                .filter((row) => row.event_id === bindings[0])
                .sort((a, b) => a.sequence - b.sequence),
              success: true,
            };
          }
          if (sql.includes("FROM runtime_household_events")) {
            return { results: [...events].sort((a, b) => a.sequence - b.sequence), success: true };
          }
          return { results: [], success: true };
        },
        async run() {
          if (sql.includes("INSERT INTO runtime_household_events")) {
            events.push({
              sequence: ++sequence,
              event_id: bindings[0],
              event_type: bindings[1],
              item_key: bindings[2],
              occurred_at: bindings[3],
              payload_json: bindings[4],
              supersedes_json: bindings[5],
              event_hash: bindings[6],
              recorded_at: bindings[7],
            });
          }
          if (sql.includes("INSERT OR REPLACE INTO runtime_household_snapshots")) {
            snapshots.set(String(bindings[0]), {
              snapshot_id: bindings[0],
              replay_id: bindings[1],
              replay_timestamp: bindings[2],
              reconciliation_status: bindings[3],
              event_count: bindings[4],
              snapshot_json: bindings[5],
              created_at: bindings[6],
            });
          }
          return { results: [], success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

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
    const db = fakeDb();
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
    const db = fakeDb();
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
    const db = fakeDb();
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
