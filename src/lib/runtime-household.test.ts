import { describe, expect, it } from "vitest";
import type { HouseholdEvent } from "./state-engine/types";
import { appendTestHouseholdEvent, readTestHouseholdState } from "./runtime-household";

type Row = Record<string, unknown>;

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
            return {
              results: [...events].sort((a, b) => a.sequence - b.sequence),
              success: true,
            };
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
    async batch() {
      return [];
    },
  };
}

const baseEvent: HouseholdEvent = {
  eventId: "evt-1",
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: "milk",
  occurredAt: "2026-08-14T08:00:00.000Z",
  payload: { quantity: 2, unit: "litre" },
};

describe("runtime household adapter", () => {
  it("appends a test event and materialises deterministic state", async () => {
    const db = fakeDb();
    const result = await appendTestHouseholdEvent(db, baseEvent);

    expect(result.appended).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(result.snapshot.items).toEqual([
      expect.objectContaining({ itemKey: "milk", quantity: 2, unit: "litre" }),
    ]);
    expect(db.events).toHaveLength(1);
    expect(db.snapshots.size).toBe(1);
  });

  it("keeps identical duplicate delivery idempotent without appending another event", async () => {
    const db = fakeDb();
    await appendTestHouseholdEvent(db, baseEvent);
    const result = await appendTestHouseholdEvent(db, baseEvent);

    expect(result.appended).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(result.snapshot.items[0]?.quantity).toBe(2);
    expect(result.eventId).toBe("evt-1");
    expect(db.events).toHaveLength(1);
  });

  it("surfaces reused event IDs with different payloads as a blocking replay conflict without appending", async () => {
    const db = fakeDb();
    await appendTestHouseholdEvent(db, baseEvent);
    const conflicting = { ...baseEvent, payload: { quantity: 3, unit: "litre" } };
    const result = await appendTestHouseholdEvent(db, conflicting);

    expect(result.appended).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.snapshot.reconciliationStatus).toBe("BLOCKED");
    expect(result.snapshot.blockedItemKeys).toContain("milk");
    expect(result.snapshot.items[0]?.quantity).toBe(2);
    expect(result.eventId).toBe("evt-1");
    expect(db.events).toHaveLength(1);
  });

  it("rejects production-class events before persistence", async () => {
    const db = fakeDb();
    await expect(
      appendTestHouseholdEvent(db, { ...baseEvent, recordClass: "Production" }),
    ).rejects.toThrow("Test events only");
    expect(db.events).toHaveLength(0);
  });

  it("rebuilds state from the durable event stream", async () => {
    const db = fakeDb();
    await appendTestHouseholdEvent(db, baseEvent);
    await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-2",
      eventType: "ITEM_STOCK_DELTA",
      payload: { quantity: -1, unit: "litre" },
      occurredAt: "2026-08-14T09:00:00.000Z",
    });

    const result = await readTestHouseholdState(db);
    expect(result.eventCount).toBe(2);
    expect(result.snapshot.items[0]?.quantity).toBe(1);
    expect(result.snapshot.items[0]?.contributingEventIds).toEqual(["evt-1", "evt-2"]);
  });

  it("keeps superseded events out of materialised state while preserving the replacement", async () => {
    const db = fakeDb();
    const original: HouseholdEvent = {
      eventId: "evt-superseded-original",
      recordClass: "Test",
      eventType: "ITEM_STOCK_SET",
      itemKey: "rice",
      occurredAt: "2026-08-14T10:00:00.000Z",
      payload: { quantity: 2, unit: "kg" },
    };
    const replacement: HouseholdEvent = {
      eventId: "evt-superseding-replacement",
      recordClass: "Test",
      eventType: "ITEM_STOCK_SET",
      itemKey: "rice",
      occurredAt: "2026-08-14T10:05:00.000Z",
      payload: { quantity: 5, unit: "kg" },
      supersedes: [original.eventId],
    };

    await appendTestHouseholdEvent(db, original);
    const result = await appendTestHouseholdEvent(db, replacement);

    expect(result.appended).toBe(true);
    expect(result.snapshot.items.find((item) => item.itemKey === "rice")).toEqual(
      expect.objectContaining({
        quantity: 5,
        contributingEventIds: [replacement.eventId],
        blocked: false,
      }),
    );
    expect(result.snapshot.ignoredEventIds).toContain(original.eventId);
    expect(result.snapshot.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUPERSEDED_EVENT_NOT_APPLIED",
          eventId: original.eventId,
          blocking: false,
        }),
      ]),
    );
    expect(result.snapshot.reconciliationStatus).toBe("EXCEPTIONS");
  });

  it("isolates negative stock without allowing the item to contaminate unrelated state", async () => {
    const db = fakeDb();
    await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-negative-set",
      itemKey: "eggs",
      payload: { quantity: 1, unit: "count" },
    });
    const result = await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-negative-consume",
      itemKey: "eggs",
      eventType: "ITEM_STOCK_DELTA",
      payload: { quantity: -2, unit: "count" },
      occurredAt: "2026-08-14T11:00:00.000Z",
    });

    const eggs = result.snapshot.items.find((item) => item.itemKey === "eggs");
    expect(eggs).toEqual(expect.objectContaining({ quantity: -1, blocked: true }));
    expect(result.snapshot.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NEGATIVE_STOCK_ISOLATED",
          eventId: "evt-negative-consume",
          itemKey: "eggs",
          blocking: false,
        }),
      ]),
    );
    expect(result.snapshot.reconciliationStatus).toBe("EXCEPTIONS");
  });

  it("blocks an incomparable unit delta without mutating the existing stock", async () => {
    const db = fakeDb();
    await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-unit-set",
      itemKey: "flour",
      payload: { quantity: 780, unit: "g" },
    });
    const result = await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-unit-conflict",
      itemKey: "flour",
      eventType: "ITEM_STOCK_DELTA",
      payload: { quantity: -1, unit: "kg" },
      occurredAt: "2026-08-14T12:00:00.000Z",
    });

    const flour = result.snapshot.items.find((item) => item.itemKey === "flour");
    expect(flour).toEqual(expect.objectContaining({ quantity: 780, unit: "g", blocked: true }));
    expect(flour?.contributingEventIds).toEqual(["evt-unit-set"]);
    expect(result.snapshot.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNIT_CONFLICT_BLOCKED",
          eventId: "evt-unit-conflict",
          itemKey: "flour",
          blocking: true,
        }),
      ]),
    );
    expect(result.snapshot.reconciliationStatus).toBe("BLOCKED");
  });

  it("preserves qualified evidence as a blocking reconciliation state", async () => {
    const db = fakeDb();
    const result = await appendTestHouseholdEvent(db, {
      ...baseEvent,
      eventId: "evt-qualified-evidence",
      itemKey: "coffee",
      payload: { quantity: 2, unit: "kg", evidencePrecision: "QUALIFIED_AMBIGUOUS" },
    });

    const coffee = result.snapshot.items.find((item) => item.itemKey === "coffee");
    expect(coffee).toEqual(
      expect.objectContaining({
        quantity: 2,
        unit: "kg",
        evidencePrecision: "QUALIFIED_AMBIGUOUS",
        blocked: true,
      }),
    );
    expect(result.snapshot.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "QUALIFIED_AMBIGUOUS_EVIDENCE",
          eventId: "evt-qualified-evidence",
          itemKey: "coffee",
          blocking: true,
        }),
      ]),
    );
    expect(result.snapshot.reconciliationStatus).toBe("BLOCKED");
  });
});
