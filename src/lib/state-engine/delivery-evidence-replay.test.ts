import { describe, expect, it } from "vitest";
import type { CanonicalAppendRecord } from "../event-writer/types";
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

const deliveryRecord = (eventId = "delivery-event-001", quantity = 2): CanonicalAppendRecord => ({
  eventId,
  payloadHash: `hash-${eventId}`,
  __canonical: "HOUSEHOLD_EVENTS",
  row: {
    "Event ID": eventId,
    "Event type": "Delivery",
    "Occurred at": "2026-09-02T19:00:00.000Z",
    "Recorded at": "2026-09-02T19:05:00.000Z",
    Source: "delivery-evidence",
    Actor: "James",
    "Entity type": "Delivery",
    "Entity reference": "TESCO-ORDER-001",
    Item: "chicken-breast",
    "Quantity delta": quantity,
    Unit: "pack",
    Evidence: "sealed-evidence-001",
    "State before": "",
    "State after": "",
    Confidence: "EXACT",
    "Supersedes event ID": [],
    "Exception / reconciliation action": "",
    "Replay status": "PROPOSED",
    "Record class": "Production",
  },
});

describe("canonical delivery evidence replay", () => {
  it("materialises delivered stock through the existing replay engine", () => {
    const result = replayCanonicalDeliveryEvidence([existing], [deliveryRecord()], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "chicken-breast", quantity: 2, unit: "pack" }),
    ]));
    expect(result.snapshot.contributingEventIds).toContain("delivery-event-001");
  });

  it("deduplicates evidence against the existing replay stream by Event ID", () => {
    const result = replayCanonicalDeliveryEvidence(
      [{ ...existing, eventId: "delivery-event-001", itemKey: "chicken-breast", payload: { quantity: 2, unit: "pack", evidencePrecision: "EXACT" } }],
      [deliveryRecord()],
      { now: () => "2026-09-03T00:00:00.000Z" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.filter((event) => event.eventId === "delivery-event-001")).toHaveLength(1);
  });

  it("fails closed for a canonical record that cannot represent a replayable delivery", () => {
    const invalid = { ...deliveryRecord("bad-delivery"), row: { ...deliveryRecord("bad-delivery").row, Unit: null } };
    const result = replayCanonicalDeliveryEvidence([], [invalid], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });

  it("fails closed for negative delivery quantity", () => {
    const result = replayCanonicalDeliveryEvidence([], [deliveryRecord("negative-delivery", -2)], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });

  it("fails closed for zero delivery quantity", () => {
    const result = replayCanonicalDeliveryEvidence([], [deliveryRecord("zero-delivery", 0)], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANONICAL_RECORD" }));
  });
});
