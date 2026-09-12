import { describe, expect, it } from "vitest";
import { sealHumanDeliveryEvidence } from "./delivery-evidence";
import { prepareDeliveryEvidenceHandoff } from "./delivery-evidence-handoff";
import { replayCanonicalDeliveryEvidence } from "./delivery-evidence-replay";

const evidenceInput = {
  basketId: "BASKET-ALPHA-2026-W36",
  orderReference: "TESCO-ORDER-12345",
  retailer: "Tesco",
  capturedAt: "2026-09-02T16:10:00.000Z",
  capturedBy: "James",
  delivery: {
    deliveryId: "DEL-ALPHA-001",
    dispatchId: "DSP-TEST-001",
    basketId: "BASKET-ALPHA-2026-W36",
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
  },
};

function canonicalDeliveryRecord() {
  const sealed = sealHumanDeliveryEvidence(evidenceInput);
  if (!sealed.ok) throw new Error(sealed.detail);
  const handoff = prepareDeliveryEvidenceHandoff(sealed.evidence, () => "2026-09-02T16:10:00.000Z");
  if (!handoff.ok) throw new Error(handoff.detail);
  return handoff.records[0]!;
}

describe("delivery evidence replay provenance", () => {
  it("accepts a genuine canonical delivery record", () => {
    const record = canonicalDeliveryRecord();
    const result = replayCanonicalDeliveryEvidence([], [record], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a cloned canonical record whose row is altered", () => {
    const genuine = canonicalDeliveryRecord();
    const forged = {
      ...genuine,
      row: { ...genuine.row, Item: "Different item" },
    };

    const result = replayCanonicalDeliveryEvidence([], [forged], {
      now: () => "2026-09-03T00:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "INVALID_CANONICAL_RECORD",
    }));
  });
});
