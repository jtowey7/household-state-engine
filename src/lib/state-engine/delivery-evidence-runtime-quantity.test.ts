import { describe, expect, it } from "vitest";
import { prepareDeliveryEvidenceHandoff } from "./delivery-evidence-handoff";
import { sealHumanDeliveryEvidence } from "./delivery-evidence";
import type { HumanDeliveryEvidence } from "./delivery-evidence";
import { mapHouseholdEventRowsWithEvidencePrecision } from "../production-adapter/evidence-aware-mapper";
import { appendTestHouseholdEvent, readTestHouseholdState } from "../runtime-household";
import { toQuantityRequirementsHandoff } from "./engine";

/** Minimal in-memory D1 double: this proof never touches Airtable or Production state. */
function fakeDb() {
  const events: Array<Record<string, unknown> & { sequence: number }> = [];
  const snapshots = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  return {
    events,
    prepare(sql: string) {
      const bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings.push(...values); return this; },
        async all() {
          if (sql.includes("FROM runtime_household_events") && sql.includes("event_hash")) {
            return { results: events.filter((r) => r.event_id === bindings[0]).sort((a, b) => a.sequence - b.sequence), success: true };
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

const delivery = {
  deliveryId: "delivery-family-alpha-2026-08-30",
  dispatchId: "dispatch-family-alpha-2026-08-30",
  basketId: "basket-family-alpha-2026-08-30",
  basketVersion: 3,
  basketFingerprint: "basket-fingerprint-family-alpha-2026-08-30",
  deliveredAt: "2026-08-30T18:45:00Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
    { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

function sealedEvidence(): HumanDeliveryEvidence {
  const result = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "TESCO-ORDER-ALPHA-001",
    retailer: "Tesco",
    capturedAt: "2026-08-30T19:00:00Z",
    capturedBy: "James",
    delivery,
  });
  if (!result.ok) throw new Error("fixture evidence failed to seal");
  return result.evidence;
}

describe("sealed delivery evidence -> canonical append -> TEST runtime -> quantity", () => {
  it("materialises canonical delivery evidence into inventory and a clean quantity handoff", async () => {
    const evidence = sealedEvidence();
    const handoff = prepareDeliveryEvidenceHandoff(evidence, () => "2026-08-30T19:01:00Z");
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    expect(handoff.records).toHaveLength(2);

    const rows = handoff.records.map((record) => ({
      id: `rec-${record.eventId}`,
      fields: record.row,
    }));
    const mapped = mapHouseholdEventRowsWithEvidencePrecision(rows);
    expect(mapped.every((result) => result.ok)).toBe(true);

    const db = fakeDb();
    for (const result of mapped) {
      if (!result.ok) continue;
      // Shadow/runtime proof deliberately converts the canonical Production event
      // to Test class. This exercises the real event shape without Production mutation.
      const runtimeEvent = { ...result.event, recordClass: "Test" as const };
      const appended = await appendTestHouseholdEvent(db, runtimeEvent);
      expect(appended.appended).toBe(true);
    }

    const state = await readTestHouseholdState(db);
    expect(state.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(state.snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "Chicken breast", quantity: 2, unit: "packs" }),
      expect.objectContaining({ itemKey: "Limes", quantity: 1, unit: "each" }),
    ]));

    const quantity = toQuantityRequirementsHandoff(state.snapshot);
    expect(quantity.readyForQuantityRun).toBe(true);
    expect(quantity.blockedItemKeys).toEqual([]);
    expect(quantity.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "Chicken breast", quantity: 2, unit: "packs" }),
      expect.objectContaining({ itemKey: "Limes", quantity: 1, unit: "each" }),
    ]));
  });

  it("retains delivery provenance through the materialised state", async () => {
    const evidence = sealedEvidence();
    const handoff = prepareDeliveryEvidenceHandoff(evidence, () => "2026-08-30T19:01:00Z");
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const mapped = mapHouseholdEventRowsWithEvidencePrecision(handoff.records.map((record) => ({
      id: `rec-${record.eventId}`,
      fields: record.row,
    })));
    const db = fakeDb();
    for (const result of mapped) {
      if (result.ok) await appendTestHouseholdEvent(db, { ...result.event, recordClass: "Test" });
    }

    const state = await readTestHouseholdState(db);
    const chicken = state.snapshot.items.find((item) => item.itemKey === "Chicken breast");
    expect(chicken?.contributingEventIds).toHaveLength(1);
    expect(chicken?.contributingEventIds[0]).toBe(handoff.records.find((record) => record.row.Item === "Chicken breast")?.eventId);
    expect(String(handoff.records.find((record) => record.row.Item === "Chicken breast")?.row.Evidence)).toContain(evidence.evidenceId);
    expect(String(handoff.records.find((record) => record.row.Item === "Chicken breast")?.row.Evidence)).toContain(delivery.dispatchId);
    expect(String(handoff.records.find((record) => record.row.Item === "Chicken breast")?.row.Evidence)).toContain(delivery.basketFingerprint);
  });

  it("does not double-count identical canonical events on repeated runtime append", async () => {
    const evidence = sealedEvidence();
    const handoff = prepareDeliveryEvidenceHandoff(evidence, () => "2026-08-30T19:01:00Z");
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const mapped = mapHouseholdEventRowsWithEvidencePrecision(handoff.records.map((record) => ({
      id: `rec-${record.eventId}`,
      fields: record.row,
    })));
    const db = fakeDb();
    const runtimeEvents = mapped.flatMap((result) => result.ok ? [{ ...result.event, recordClass: "Test" as const }] : []);
    for (const event of runtimeEvents) await appendTestHouseholdEvent(db, event);
    const repeated = [];
    for (const event of runtimeEvents) repeated.push(await appendTestHouseholdEvent(db, event));

    expect(repeated.every((result) => result.duplicate && !result.conflict && !result.appended)).toBe(true);
    expect(db.events).toHaveLength(runtimeEvents.length);
    const state = await readTestHouseholdState(db);
    expect(state.snapshot.items.find((item) => item.itemKey === "Chicken breast")?.quantity).toBe(2);
    expect(state.snapshot.items.find((item) => item.itemKey === "Limes")?.quantity).toBe(1);
  });
});
