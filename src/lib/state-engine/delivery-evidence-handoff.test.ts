import { describe, expect, it } from "vitest";
import { createFakeAppendPort } from "../event-writer/ports";
import { sealHumanDeliveryEvidence } from "./delivery-evidence";
import { prepareDeliveryEvidenceHandoff } from "./delivery-evidence-handoff";

const delivery = {
  deliveryId: "DEL-RUNTIME-001",
  deliveredAt: "2026-09-02T19:00:00.000Z",
  reconciliationStatus: "RECONCILED" as const,
  dispatchId: "DISPATCH-ALPHA-001",
  basketId: "BASKET-ALPHA-001",
  basketVersion: 3,
  basketFingerprint: "fp-alpha-001",
  lines: [
    {
      lineId: "LINE-CHICKEN",
      itemKey: "chicken-fillets",
      deliveredQuantity: 1000,
      unit: "g",
      substituted: true,
    },
  ],
};

describe("delivery evidence runtime/operator handoff", () => {
  it("verifies, canonicalises and appends the sealed evidence exactly once", async () => {
    const sealed = sealHumanDeliveryEvidence({
      basketId: "BASKET-ALPHA-001",
      orderReference: "TESCO-ORDER-001",
      retailer: "Tesco",
      capturedAt: "2026-09-02T19:05:00.000Z",
      capturedBy: "James",
      delivery,
    });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const handoff = prepareDeliveryEvidenceHandoff(sealed.evidence, () => "2026-09-02T19:06:00.000Z");
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    expect(handoff.records).toHaveLength(1);
    expect(handoff.records[0]!.row["Event type"]).toBe("Delivery");
    expect(handoff.records[0]!.row.Item).toBe("chicken-fillets");
    expect(handoff.records[0]!.row["Quantity delta"]).toBe(1000);
    expect(handoff.records[0]!.row.Evidence).toContain(sealed.evidence.evidenceId);
    expect(handoff.records[0]!.row.Evidence).toContain("DISPATCH-ALPHA-001");

    const port = createFakeAppendPort();
    const first = await port.append(handoff.records[0]);
    const second = await port.append(handoff.records[0]);
    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    expect(port.ledger()).toHaveLength(1);
  });

  it("fails closed when sealed evidence is tampered before the handoff", () => {
    const sealed = sealHumanDeliveryEvidence({
      basketId: "BASKET-ALPHA-001",
      orderReference: "TESCO-ORDER-001",
      retailer: "Tesco",
      capturedAt: "2026-09-02T19:05:00.000Z",
      capturedBy: "James",
      delivery,
    });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const tampered = { ...sealed.evidence, basketId: "BASKET-OTHER" };
    const handoff = prepareDeliveryEvidenceHandoff(tampered);
    expect(handoff.ok).toBe(false);
    if (handoff.ok) return;
    expect(handoff.code).toBe("INVALID_EVIDENCE");
  });
});
