import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import { appendTestHouseholdEvent, readTestHouseholdState } from "../runtime-household";
import { toQuantityRequirementsHandoff } from "../state-engine/engine";
import { stockCorrectionToTestStateEvent } from "./to-state-event";
import type { StockCorrectionProposal } from "./types";

type Row = Record<string, unknown>;
function fakeDb() {
  const events: Array<Row & { sequence: number }> = [];
  const snapshots = new Map<string, Row>();
  let sequence = 0;
  return {
    events,
    prepare(sql: string) {
      const bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings.push(...values); return this; },
        async all() {
          if (sql.includes("FROM runtime_household_events") && sql.includes("event_hash")) return { results: events.filter((r) => r.event_id === bindings[0]).sort((a,b) => a.sequence-b.sequence), success: true };
          if (sql.includes("FROM runtime_household_events")) return { results: [...events].sort((a,b) => a.sequence-b.sequence), success: true };
          return { results: [], success: true };
        },
        async run() {
          if (sql.includes("INSERT INTO runtime_household_events")) events.push({ sequence: ++sequence, event_id: bindings[0], event_type: bindings[1], item_key: bindings[2], occurred_at: bindings[3], payload_json: bindings[4], supersedes_json: bindings[5], event_hash: bindings[6], recorded_at: bindings[7] });
          if (sql.includes("INSERT OR REPLACE INTO runtime_household_snapshots")) snapshots.set(String(bindings[0]), { snapshot_id: bindings[0], replay_id: bindings[1], replay_timestamp: bindings[2], reconciliation_status: bindings[3], event_count: bindings[4], snapshot_json: bindings[5], created_at: bindings[6] });
          return { results: [], success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) { const results: unknown[] = []; for (const statement of statements) results.push(await statement.run()); return results; },
  };
}
function proposal(): StockCorrectionProposal {
  const intent = { eventType: "Correction" as const, item: "milk", occurredAt: "2026-09-02T05:00:00Z", stateAfter: 2, unit: "unit", source: "household-stock-input", actor: "James", entityType: "Inventory item", evidence: "stocktake:milk:2", confidence: "High", exceptionAction: "stocktake", recordClass: "Test" as const };
  const canonical = canonicaliseAppend(intent, { now: () => "2026-09-02T05:01:00Z" });
  if (!canonical.ok) throw new Error(canonical.rejection.detail);
  return { proposalKey: "exception::stock-1::milk", eventId: canonical.record.eventId, payloadHash: canonical.record.payloadHash, provenanceHash: "provenance", exceptionId: "stock-1", itemKey: "milk", stateAfter: 2, unit: "unit", occurredAt: "2026-09-02T05:00:00Z", reason: "stocktake", recordClass: "Test", intent, record: canonical.record, preview: { eventId: canonical.record.eventId, payloadHash: canonical.record.payloadHash, row: canonical.record.row, request: { method: "POST", tableLabel: "HOUSEHOLD EVENTS", body: { records: [{ fields: canonical.record.row }] } } }, requiresHumanAuthorization: true };
}
describe("stock input -> TEST runtime -> quantity handoff", () => {
  it("materialises accepted stock input and preserves source event provenance", async () => {
    const db = fakeDb();
    const projected = stockCorrectionToTestStateEvent(proposal());
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const appended = await appendTestHouseholdEvent(db, projected.event);
    expect(appended.appended).toBe(true);
    expect(appended.snapshot.items).toContainEqual(expect.objectContaining({ itemKey: "milk", quantity: 2, unit: "unit", contributingEventIds: [projected.event.eventId] }));
    const state = await readTestHouseholdState(db);
    const handoff = toQuantityRequirementsHandoff(state.snapshot);
    expect(handoff.items).toContainEqual(expect.objectContaining({ itemKey: "milk", quantity: 2, unit: "unit", sourceEventIds: [projected.event.eventId] }));
    expect(handoff.readyForQuantityRun).toBe(true);
  });
  it("keeps identical replay idempotent and conflicting reuse blocked without a second append", async () => {
    const db = fakeDb();
    const projected = stockCorrectionToTestStateEvent(proposal());
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    await appendTestHouseholdEvent(db, projected.event);
    const duplicate = await appendTestHouseholdEvent(db, projected.event);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appended).toBe(false);
    const conflict = await appendTestHouseholdEvent(db, { ...projected.event, payload: { ...projected.event.payload, quantity: 3 } });
    expect(conflict.conflict).toBe(true);
    expect(conflict.appended).toBe(false);
    expect(conflict.snapshot.reconciliationStatus).toBe("BLOCKED");
    expect(db.events).toHaveLength(1);
  });
});
