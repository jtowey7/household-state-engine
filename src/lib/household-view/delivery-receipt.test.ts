import { describe, expect, it } from "vitest";

import { detectAppliedDeliveryReceipt, type DeliveryEventRow } from "./delivery-receipt";

const identity = { basketId: "basket-7-13-sep", basketVersion: 2, basketFingerprint: "fp-abc" };

function evidence(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    evidenceId: "EV-1",
    basketId: identity.basketId,
    basketVersion: identity.basketVersion,
    basketFingerprint: identity.basketFingerprint,
    deliveryId: "MANUAL-DELIVERY:basket-7-13-sep:2026-09-12T10:00:00.000Z",
    ...overrides,
  });
}

function row(overrides: Partial<DeliveryEventRow> = {}): DeliveryEventRow {
  return {
    eventId: "EVT-1",
    recordClass: "Production",
    replayStatus: "Applied",
    occurredAt: "2026-09-12T10:00:00.000Z",
    evidence: evidence(),
    ...overrides,
  };
}

describe("detectAppliedDeliveryReceipt", () => {
  it("confirms receipt when Applied Production events carry the exact basket identity", () => {
    const result = detectAppliedDeliveryReceipt([row(), row({ eventId: "EVT-2" })], identity);
    expect(result).toEqual({
      confirmed: true,
      deliveryId: "MANUAL-DELIVERY:basket-7-13-sep:2026-09-12T10:00:00.000Z",
      deliveredAt: "2026-09-12T10:00:00.000Z",
      appliedEventIds: ["EVT-1", "EVT-2"],
    });
  });

  it("tolerates the canonical approval suffix appended after the sealed evidence JSON", () => {
    const result = detectAppliedDeliveryReceipt([row({ evidence: `${evidence()} | approval:APR-1` })], identity);
    expect(result.confirmed).toBe(true);
  });

  it("refuses a receipt when replay status is not Applied", () => {
    expect(detectAppliedDeliveryReceipt([row({ replayStatus: "Pending" })], identity).confirmed).toBe(false);
  });

  it("refuses a receipt from Test records", () => {
    expect(detectAppliedDeliveryReceipt([row({ recordClass: "Test" })], identity).confirmed).toBe(false);
  });

  it("refuses a receipt when the basket version or fingerprint differs", () => {
    expect(detectAppliedDeliveryReceipt([row({ evidence: evidence({ basketVersion: 1 }) })], identity).confirmed).toBe(false);
    expect(detectAppliedDeliveryReceipt([row({ evidence: evidence({ basketFingerprint: "fp-other" }) })], identity).confirmed).toBe(false);
  });

  it("refuses unparsable or absent evidence", () => {
    expect(detectAppliedDeliveryReceipt([row({ evidence: "not json" })], identity).confirmed).toBe(false);
    expect(detectAppliedDeliveryReceipt([row({ evidence: null })], identity).confirmed).toBe(false);
  });

  it("refuses ambiguous evidence of two different deliveries for the same basket", () => {
    const other = row({ eventId: "EVT-3", evidence: evidence({ deliveryId: "MANUAL-DELIVERY:other" }) });
    expect(detectAppliedDeliveryReceipt([row(), other], identity).confirmed).toBe(false);
  });

  it("refuses when no rows exist at all", () => {
    expect(detectAppliedDeliveryReceipt([], identity).confirmed).toBe(false);
  });
});
