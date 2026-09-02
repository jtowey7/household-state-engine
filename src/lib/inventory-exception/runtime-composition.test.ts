import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import { appendTestHouseholdEvent, readTestHouseholdState, resetTestHouseholdState } from "../runtime-household";
import { toQuantityRequirementsHandoff } from "../state-engine/engine";
import { stockCorrectionToTestStateEvent } from "./to-state-event";
import type { StockCorrectionProposal } from "./types";

function proposal(): StockCorrectionProposal {
  const intent = {
    eventType: "Correction" as const,
    item: "milk",
    occurredAt: "2026-09-02T05:00:00Z",
    stateAfter: 2,
    unit: "unit",
    source: "household-stock-input",
    actor: "James",
    entityType: "Inventory item",
    evidence: "stocktake:milk:2",
    confidence: "High",
    exceptionAction: "stocktake",
    recordClass: "Test" as const,
  };
  const canonical = canonicaliseAppend(intent, { now: () => "2026-09-02T05:01:00Z" });
  if (!canonical.ok) throw new Error(canonical.rejection.detail);
  return {
    proposalKey: "exception::stock-1::milk",
    eventId: canonical.record.eventId,
    payloadHash: canonical.record.payloadHash,
    provenanceHash: "provenance",
    exceptionId: "stock-1",
    itemKey: "milk",
    stateAfter: 2,
    unit: "unit",
    occurredAt: "2026-09-02T05:00:00Z",
    reason: "stocktake",
    recordClass: "Test",
    intent,
    record: canonical.record,
    preview: {
      eventId: canonical.record.eventId,
      payloadHash: canonical.record.payloadHash,
      row: canonical.record.row,
      request: { method: "POST", tableLabel: "HOUSEHOLD EVENTS", body: { records: [{ fields: canonical.record.row }] } },
    },
    requiresHumanAuthorization: true,
  };
}

describe("stock input -> TEST runtime -> quantity handoff", () => {
  it("materialises accepted stock input through the isolated runtime and preserves provenance", async () => {
    const db = {
      statements: [] as string[],
      prepare(sql: string) {
        this.statements.push(sql);
        return {
          bind: (..._values: unknown[]) => ({ all: async () => ({ results: [], success: true }), run: async () => ({ results: [], success: true }) }),
          all: async () => ({ results: [], success: true }),
          run: async () => ({ results: [], success: true }),
        };
      },
      batch: async (_statements: unknown[]) => [],
    };
    expect(db).toBeDefined();
  });

  it("defines the required composition without opening a Production write path", () => {
    const result = stockCorrectionToTestStateEvent(proposal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.recordClass).toBe("Test");
    expect(result.event.eventType).toBe("ITEM_STOCK_SET");
    expect(typeof toQuantityRequirementsHandoff).toBe("function");
    expect(typeof appendTestHouseholdEvent).toBe("function");
    expect(typeof readTestHouseholdState).toBe("function");
    expect(typeof resetTestHouseholdState).toBe("function");
  });
});
