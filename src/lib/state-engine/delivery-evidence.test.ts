import { describe, expect, it } from "vitest";
import { sealHumanDeliveryEvidence, verifyHumanDeliveryEvidence } from "./delivery-evidence";

const delivery = {
  deliveryId: "DEL-ALPHA-001",
  dispatchId: "DSP-TEST-001",
  basketId: "BASKET-TEST-001",
  basketVersion: 1,
  basketFingerprint: "fingerprint-test-001",
  deliveredAt: "2026-09-02T16:00:00.000Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    {
      lineId: "LINE-001",
      itemKey: "Tesco Chicken Fillets",
      deliveredQuantity: 1000,
      unit: "g",
      substituted: false,
    },
  ],
};

describe("human purchase/delivery evidence envelope", () => {
  it("binds a human-recorded delivery to the exact basket/order and verifies intact provenance", () => {
    const result = sealHumanDeliveryEvidence({
      basketId: "BASKET-ALPHA-2026-W36",
      orderReference: "TESCO-ORDER-12345",
      retailer: "Tesco",
      capturedAt: "2026-09-02T16:10:00.000Z",
      capturedBy: "James",
      delivery,
      evidenceNote: "Human recorded delivered quantities after checking the delivery.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.evidence.provenance).toBe("HUMAN_RECORDED_PURCHASE_DELIVERY");
    expect(result.evidence.evidenceId).toBe(`DELIVERY-EVIDENCE:${result.evidence.digest}`);
    expect(result.evidence.basketId).toBe("BASKET-ALPHA-2026-W36");
    expect(result.evidence.orderReference).toBe("TESCO-ORDER-12345");
    expect(verifyHumanDeliveryEvidence(result.evidence)).toBe(true);
  });

  it("rejects an unresolved delivery before it can become durable household evidence", () => {
    const result = sealHumanDeliveryEvidence({
      basketId: "BASKET-ALPHA-2026-W36",
      orderReference: "TESCO-ORDER-12345",
      retailer: "Tesco",
      capturedAt: "2026-09-02T16:10:00.000Z",
      capturedBy: "James",
      delivery: { ...delivery, reconciliationStatus: "PENDING" as never },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_EVIDENCE");
  });

  it("detects tampering with the basket/order binding or delivery payload", () => {
    const result = sealHumanDeliveryEvidence({
      basketId: "BASKET-ALPHA-2026-W36",
      orderReference: "TESCO-ORDER-12345",
      retailer: "Tesco",
      capturedAt: "2026-09-02T16:10:00.000Z",
      capturedBy: "James",
      delivery,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tampered = {
      ...result.evidence,
      orderReference: "TESCO-ORDER-99999",
    };
    expect(verifyHumanDeliveryEvidence(tampered)).toBe(false);
  });

  it("is deterministic for the same evidence payload", () => {
    const input = {
      basketId: "BASKET-ALPHA-2026-W36",
      orderReference: "TESCO-ORDER-12345",
      retailer: "Tesco",
      capturedAt: "2026-09-02T16:10:00.000Z",
      capturedBy: "James",
      delivery,
    };

    const first = sealHumanDeliveryEvidence(input);
    const second = sealHumanDeliveryEvidence(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.evidence.evidenceId).toBe(first.evidence.evidenceId);
    expect(second.evidence.digest).toBe(first.evidence.digest);
  });
});
