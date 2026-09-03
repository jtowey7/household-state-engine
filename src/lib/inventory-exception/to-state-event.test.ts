import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import type { StockCorrectionProposal } from "./types";
import { stockCorrectionToTestStateEvent } from "./to-state-event";

function proposal(overrides: Partial<StockCorrectionProposal> = {}): StockCorrectionProposal {
  const intent = {
    eventType: "Correction" as const,
    item: "milk",
    occurredAt: "2026-09-01T00:00:00Z",
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
  const canonical = canonicaliseAppend(intent, { now: () => "2026-09-01T00:01:00Z" });
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
    occurredAt: "2026-09-01T00:00:00Z",
    reason: "stocktake",
    recordClass: "Test",
    intent,
    record: canonical.record,
    preview: {
      eventId: canonical.record.eventId,
      payloadHash: canonical.record.payloadHash,
      row: canonical.record.row,
      request: {
        method: "POST",
        tableLabel: "HOUSEHOLD EVENTS",
        body: { records: [{ fields: canonical.record.row }] },
      },
    },
    requiresHumanAuthorization: true,
    ...overrides,
  };
}

describe("stockCorrectionToTestStateEvent", () => {
  it("maps an accepted canonical stock correction to the existing State Engine set event", () => {
    const result = stockCorrectionToTestStateEvent(proposal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toEqual({
      eventId: result.event.eventId,
      recordClass: "Test",
      eventType: "ITEM_STOCK_SET",
      itemKey: "milk",
      occurredAt: "2026-09-01T00:00:00Z",
      payload: {
        quantity: 2,
        unit: "unit",
        note: "stocktake",
        evidencePrecision: "EXACT",
      },
    });
  });

  it("refuses a Production proposal", () => {
    const p = proposal({ recordClass: "Production" });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "PRODUCTION_PROPOSAL" });
  });

  it("refuses a structurally copied record that is not a canonical capability", () => {
    const p = proposal({ record: { ...proposal().record } });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "NON_CANONICAL_PROPOSAL" });
  });

  it("refuses proposal metadata for a different item even when the canonical record is valid", () => {
    const p = proposal({ itemKey: "butter" });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "CANONICAL_PAYLOAD_MISMATCH" });
  });

  it("refuses proposal metadata with a different absolute quantity", () => {
    const p = proposal({ stateAfter: 7 });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "CANONICAL_PAYLOAD_MISMATCH" });
  });

  it("refuses proposal metadata with a different observation time", () => {
    const p = proposal({ occurredAt: "2026-09-02T00:00:00Z" });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "CANONICAL_PAYLOAD_MISMATCH" });
  });

  it("refuses proposal reason drift from the canonical exception action", () => {
    const p = proposal();
    p.reason = "tampered-reason";
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "CANONICAL_PAYLOAD_MISMATCH" });
  });

  it("refuses proposal supersession drift from the canonical payload", () => {
    const p = proposal();
    p.intent = { ...p.intent, supersedes: ["event-other"] };
    const result = stockCorrectionToTestStateEvent(p);
    expect(result).toMatchObject({ ok: false, code: "CANONICAL_PAYLOAD_MISMATCH" });
  });

  it("preserves explicit supersession without inventing one", () => {
    const p = proposal({
      intent: { ...proposal().intent, supersedes: ["event-old-2", "event-old-1"] },
    });
    const result = stockCorrectionToTestStateEvent(p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.supersedes).toEqual(["event-old-1", "event-old-2"]);
  });
});
