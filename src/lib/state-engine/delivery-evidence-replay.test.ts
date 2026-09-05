import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import type { AppendIntent } from "../write-boundary/types";
import { replayCanonicalDeliveryEvidence } from "./delivery-evidence-replay";
import type { HouseholdEvent } from "./types";

const existing: HouseholdEvent = {
  eventId: "existing-event-001",
  recordClass: "Production",
  eventType: "ITEM_STOCK_DELTA",
  itemKey: "milk",
  occurredAt: "2026-09-02T08:00:00.000Z",
  payload: { quantity: 2, unit: "litre", evidencePrecision: "EXACT" },
};

const deliveryIntent = (identityContext: string, quantity = 2): AppendIntent => ({
  eventType: "Delivery",
  item: "chicken-breast",
  occurredAt: "2026-09-02T19:00:00.000Z",
  quantityDelta: quantity,
  unit: "pack",
  source: "delivery-evidence",
  actor: "James",
  evidence: "sealed-evidence-001",
  recordClass: "Production",
  entityType: "Delivery",
  entityReference: "TESCO-ORDER-001",
  identityContext,
});

const deliveryRecord = (identityContext = "delivery-event-001", quantity = 2) => {
  const result = canonicaliseAppend(deliveryIntent(identityContext, quantity), {
    now: () => "2026-09-02T19:05:00.000Z",
  });
  if (!result.ok) throw new Error(`fixture must canonicalise: ${result.rejection.code}`);
  return result.record;
};

describe("canonical delivery evidence replay", () => {
  it("materialises delivered stock through the existing replay engine", () => {
    const record = deliveryRecord();
    const result = replayCanonicalDeliveryEvidence([existing], [record], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "chicken-breast", quantity: 2, unit: "pack" }),
    ]));
    expect(result.snapshot.contributingEventIds).toContain(record.eventId);
  });

  it("deduplicates evidence against the existing replay stream by Event ID", () => {
    const record = deliveryRecord();
    const result = replayCanonicalDeliveryEvidence(
      [{ ...existing, eventId: record.eventId, itemKey: "chicken-breast", payload: { quantity: 2, unit: "pack", evidencePrecision: "EXACT" } }],
      [record],
      { now: () => "2026-09-03T00:00:00.000Z" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.filter((event) => event.eventId === record.eventId)).toHaveLength(1);
  });

  it("fails closed for a canonical record that cannot represent a replayable delivery", () => {
    const canonical = deliveryRecord("bad-delivery");
    const invalid = { ...canonical, row: { ...canonical.row, Unit: null } };
    const result = replayCanonicalDeliveryEvidence([], [invalid], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });

  it("fails closed for negative delivery quantity", () => {
    const canonical = deliveryRecord("negative-delivery");
    const invalid = { ...canonical, row: { ...canonical.row, "Quantity delta": -2 } };
    const result = replayCanonicalDeliveryEvidence([], [invalid], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });

  it("fails closed for zero delivery quantity", () => {
    const canonical = deliveryRecord("zero-delivery");
    const invalid = { ...canonical, row: { ...canonical.row, "Quantity delta": 0 } };
    const result = replayCanonicalDeliveryEvidence([], [invalid], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });
});
