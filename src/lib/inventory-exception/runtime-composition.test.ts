import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import { previewOfRecord } from "../event-writer/preview";
import { createRuntimeHouseholdTestDb } from "../runtime-household-test-double";
import { appendTestHouseholdEvent, readTestHouseholdState } from "../runtime-household";
import { toQuantityRequirementsHandoff } from "../state-engine/engine";
import { stockCorrectionToTestStateEvent } from "./to-state-event";
import type { StockCorrectionProposal } from "./types";

function proposal(): StockCorrectionProposal {
  const intent = { eventType: "Correction" as const, item: "milk", occurredAt: "2026-09-02T05:00:00Z", stateAfter: 2, unit: "unit", source: "household-stock-input", actor: "James", entityType: "Inventory item", evidence: "stocktake:milk:2", confidence: "High", exceptionAction: "stocktake", recordClass: "Test" as const };
  const canonical = canonicaliseAppend(intent, { now: () => "2026-09-02T05:01:00Z" });
  if (!canonical.ok) throw new Error(canonical.rejection.detail);
  return { proposalKey: "exception::stock-1::milk", eventId: canonical.record.eventId, payloadHash: canonical.record.payloadHash, provenanceHash: "provenance", exceptionId: "stock-1", itemKey: "milk", stateAfter: 2, unit: "unit", occurredAt: "2026-09-02T05:00:00Z", reason: "stocktake", recordClass: "Test", intent, record: canonical.record, preview: previewOfRecord(canonical.record), requiresHumanAuthorization: true };
}
describe("stock input -> TEST runtime -> quantity handoff", () => {
  it("materialises accepted stock input and preserves source event provenance", async () => {
    const db = createRuntimeHouseholdTestDb();
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
    const db = createRuntimeHouseholdTestDb();
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
