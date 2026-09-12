import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import { createFakeAppendPort } from "../event-writer/ports";
import { sealHumanDeliveryEvidence, verifyHumanDeliveryEvidence } from "./delivery-evidence";
import { buildHumanDeliveryEvidenceAppendIntents } from "./delivery-evidence-ledger";
import type { ReconciledDelivery } from "./delivery-inventory";

const delivery: ReconciledDelivery = {
  deliveryId: "delivery-alpha-001",
  dispatchId: "DSP-TEST-001",
  basketId: "BASKET-TEST-001",
  basketVersion: 1,
  basketFingerprint: "fingerprint-test-001",
  dispatchId: "dispatch-alpha-001",
  basketId: "basket-alpha-v1",
  basketVersion: 1,
  basketFingerprint: "basket-fingerprint-alpha",
  deliveredAt: "2026-09-02T15:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [
    { lineId: "line-1", itemKey: "Tesco Chicken Breast", deliveredQuantity: 2, unit: "pack" },
    { lineId: "line-2", itemKey: "Tesco Lemons", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

function sealed() {
  const result = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "ORDER-ALPHA-001",
    retailer: "Tesco",
    capturedAt: "2026-09-02T16:00:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!result.ok) throw new Error(result.detail);
  return result.evidence;
}

describe("human delivery evidence -> HOUSEHOLD EVENTS intent boundary", () => {
  it("retains the sealed evidence identity and exact delivery provenance on every event", () => {
    const evidence = sealed();
    const result = buildHumanDeliveryEvidenceAppendIntents(evidence);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.intents).toHaveLength(2);
    expect(result.intents.map((intent) => intent.eventType)).toEqual(["Delivery", "Delivery"]);
    expect(result.intents.map((intent) => intent.quantityDelta)).toEqual([2, 1]);
    expect(result.intents.every((intent) => intent.recordClass === "Production")).toBe(true);
    expect(result.intents.every((intent) => intent.entityType === "Inventory item")).toBe(true);
    expect(result.intents.every((intent) => intent.confidence === "Confirmed")).toBe(true);
    expect(result.intents.every((intent) => intent.evidence.includes(evidence.evidenceId))).toBe(true);
    expect(result.intents.every((intent) => intent.evidence.includes(evidence.digest))).toBe(true);
    expect(result.intents.every((intent) => intent.evidence.includes(delivery.dispatchId))).toBe(true);
  });

  it("canonicalises to an append-only ledger and repeated submission is idempotent", async () => {
    const evidence = sealed();
    const built = buildHumanDeliveryEvidenceAppendIntents(evidence);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const port = createFakeAppendPort();
    const records = built.intents.map((intent) => {
      const result = canonicaliseAppend(intent, { now: () => "2026-09-02T16:01:00.000Z" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.rejection.detail);
      return result.record;
    });

    for (const record of records) await port.append(record);
    for (const record of records) {
      const duplicate = await port.append(record);
      expect(duplicate.duplicate).toBe(true);
    }
    expect(port.ledger()).toHaveLength(2);
  });

  it("refuses to invent a missing delivered unit", () => {
    const evidence = sealed();
    const missingUnit = {
      ...evidence,
      delivery: { ...evidence.delivery, lines: [{ ...evidence.delivery.lines[0], unit: null }] },
    };
    const result = buildHumanDeliveryEvidenceAppendIntents(missingUnit);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_EVIDENCE",
      detail: "Delivered line line-1 has no unit; refusing to invent one.",
    });
  });

  it("rejects tampered evidence before it is treated as durable provenance", () => {
    const evidence = sealed();
    expect(verifyHumanDeliveryEvidence(evidence)).toBe(true);
    const tampered = { ...evidence, orderReference: "ORDER-TAMPERED" };
    expect(verifyHumanDeliveryEvidence(tampered)).toBe(false);
  });
});
