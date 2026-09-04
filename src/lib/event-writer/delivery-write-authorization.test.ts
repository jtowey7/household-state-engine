import { describe, expect, it } from "vitest";
import { prepareDeliveryEvidenceHandoff } from "../state-engine/delivery-evidence-handoff";
import { sealHumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import { batchFingerprintFor, canonicaliseAppend, createHouseholdEventWriter } from "./index";
import type { AppendAuthorization, CanonicalAppendRecord, ProductionEventAppendPort } from "./types";

const now = () => "2026-09-02T21:00:00.000Z";

const delivery = {
  deliveryId: "delivery-write-auth-001",
  dispatchId: "dispatch-write-auth-001",
  basketId: "basket-write-auth-001",
  basketVersion: 1,
  basketFingerprint: "fingerprint-write-auth-001",
  deliveredAt: "2026-09-02T20:00:00.000Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [{ lineId: "line-1", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" }],
};

function sealedEvidence() {
  const result = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "ORDER-WRITE-AUTH-001",
    retailer: "Tesco",
    capturedAt: "2026-09-02T20:30:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!result.ok) throw new Error("fixture evidence failed to seal");
  return result.evidence;
}

function deliveryRecord(): CanonicalAppendRecord {
  const handoff = prepareDeliveryEvidenceHandoff(sealedEvidence(), now);
  if (!handoff.ok) throw new Error(`handoff failed: ${handoff.detail}`);
  const record = handoff.records[0];
  if (!record) throw new Error("missing canonical delivery record");
  return record;
}

function productionPort(): ProductionEventAppendPort & { appended: CanonicalAppendRecord[] } {
  const appended: CanonicalAppendRecord[] = [];
  return {
    portId: "production-boundary-test-double",
    provenance: "PRODUCTION",
    appended,
    async append(record) {
      appended.push(record);
      return { connectorRecordId: `test-rec-${appended.length}`, acknowledgedAt: now() };
    },
  };
}

function authorization(record: CanonicalAppendRecord, overrides: Partial<AppendAuthorization> = {}): AppendAuthorization {
  return {
    authorizationId: "DELIVERY-AUTH-001",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-09-02T20:45:00.000Z",
    evidenceSource: "EXPLICIT_USER_INPUT",
    evidenceDetail: "Explicit approval to record the reconciled delivery evidence as HOUSEHOLD EVENTS.",
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: "ACTION POLICY: record reconciled delivery result",
    policyIdentity: "family-alpha-household-event:v1",
    policyVersion: 1,
    ...overrides,
  };
}

describe("delivery evidence -> authorised HOUSEHOLD EVENTS write boundary", () => {
  it("refuses a production append without explicit authorization", async () => {
    const record = deliveryRecord();
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });

    const receipt = await writer.append(record);

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_REQUIRED");
    expect(receipt.written).toBe(false);
    expect(port.appended).toHaveLength(0);
  });

  it("refuses approval scoped to another delivery event before connector call", async () => {
    const record = deliveryRecord();
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });

    const receipt = await writer.append(record, authorization(record, { eventId: "EVT-OTHER-DELIVERY" }));

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("accepts only the exact approved canonical delivery event and records provenance", async () => {
    const record = deliveryRecord();
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const approval = authorization(record);

    const receipt = await writer.append(record, approval);

    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(receipt.written).toBe(true);
    expect(receipt.inventoryMutated).toBe(false);
    expect(receipt.authorization).toEqual(expect.objectContaining({
      authorizationId: approval.authorizationId,
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      actionPolicyReference: approval.actionPolicyReference,
    }));
    expect(port.appended).toHaveLength(1);
    expect(port.appended[0]?.eventId).toBe(record.eventId);
    expect(port.appended[0]?.payloadHash).toBe(record.payloadHash);
    expect(String(port.appended[0]?.row.Evidence)).toContain("DELIVERY-AUTH-001".replace("DELIVERY-AUTH-001", sealedEvidence().evidenceId));
  });

  it("does not let an approval for one delivery record authorize another", async () => {
    const first = deliveryRecord();
    const secondResult = canonicaliseAppend(
      {
        eventType: "Delivery",
        item: "Milk",
        occurredAt: delivery.deliveredAt,
        quantityDelta: 1,
        unit: "litres",
        source: "Human delivery evidence",
        actor: "James",
        entityType: "Delivery",
        entityReference: delivery.deliveryId,
        evidence: "second canonical delivery",
        confidence: "High",
        recordClass: "Production",
      },
      { now },
    );
    if (!secondResult.ok) throw new Error("second fixture failed");

    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await writer.append(secondResult.record, authorization(first));

    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("preserves the exact canonical batch fingerprint when multiple delivery records are approved together", async () => {
    const first = deliveryRecord();
    const secondResult = canonicaliseAppend(
      {
        eventType: "Delivery",
        item: "Limes",
        occurredAt: delivery.deliveredAt,
        quantityDelta: 4,
        unit: "each",
        source: "Human delivery evidence",
        actor: "James",
        entityType: "Delivery",
        entityReference: delivery.deliveryId,
        evidence: "second canonical delivery",
        confidence: "High",
        recordClass: "Production",
      },
      { now },
    );
    if (!secondResult.ok) throw new Error("second fixture failed");

    const records = [first, secondResult.record];
    expect(batchFingerprintFor(records)).toBe(batchFingerprintFor([...records].reverse()));
  });
});
