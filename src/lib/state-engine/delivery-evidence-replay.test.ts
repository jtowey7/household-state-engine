import { describe, expect, it } from "vitest";
import { sealHumanDeliveryEvidence } from "./delivery-evidence";
import { prepareDeliveryEvidenceHandoff } from "./delivery-evidence-handoff";

const delivery = {
  deliveryId: "DEL-REPLAY-001",
  dispatchId: "dispatch-family-alpha-replay",
  basketId: "basket-family-alpha-replay",
  basketVersion: 1,
  basketFingerprint: "basket-fingerprint-replay",
  deliveredAt: "2026-09-02T16:00:00.000Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    { lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 2, unit: "pack" },
    { lineId: "L2", itemKey: "limes", deliveredQuantity: 4, unit: "each", substituted: true },
  ],
};

function evidence() {
  const sealed = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "TESCO-REPLAY-001",
    retailer: "Tesco",
    capturedAt: "2026-09-02T17:00:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!sealed.ok) throw new Error("fixture evidence failed to seal");
  return sealed.evidence;
}

describe("sealed delivery evidence replay mapping", () => {
  it("emits replay events with the same canonical Event IDs and quantities", () => {
    const sealed = evidence();
    const result = prepareDeliveryEvidenceHandoff(sealed, () => "2026-09-02T17:01:00.000Z");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.records).toHaveLength(2);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.eventId)).toEqual(
      result.records.map((record) => record.eventId),
    );
    expect(result.events.map((event) => [event.itemKey, event.payload.quantity, event.payload.unit])).toEqual([
      ["chicken-breast", 2, "pack"],
      ["limes", 4, "each"],
    ]);
    expect(result.events.every((event) => event.eventType === "ITEM_STOCK_DELTA")).toBe(true);
    expect(result.events.every((event) => event.recordClass === "Production")).toBe(true);
    expect(result.events.every((event) => event.payload.evidencePrecision === "EXACT")).toBe(true);
  });

  it("fails closed rather than producing replay events for tampered evidence", () => {
    const sealed = evidence();
    const tampered = { ...sealed, basketId: "basket-other" };
    const result = prepareDeliveryEvidenceHandoff(tampered, () => "2026-09-02T17:01:00.000Z");

    expect(result).toEqual({
      ok: false,
      code: "INVALID_EVIDENCE",
      detail: "Delivery evidence failed integrity verification.",
    });
  });
});
