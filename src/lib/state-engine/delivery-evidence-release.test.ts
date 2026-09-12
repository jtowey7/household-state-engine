import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "../event-writer/canonical";
import { createFakeAppendPort, createHouseholdEventWriter } from "../event-writer";
import type { AppendAuthorization } from "../event-writer/types";
import type { AppendIntent } from "../write-boundary/types";
import { sealHumanDeliveryEvidence } from "./delivery-evidence";
import { releaseDeliveryEvidenceAppends } from "./delivery-evidence-release";
import type { ReconciledDelivery } from "./delivery-inventory";

const delivery: ReconciledDelivery = {
  deliveryId: "DEL-RELEASE-001",
  dispatchId: "dispatch-alpha-release",
  basketId: "basket-alpha-release",
  basketVersion: 1,
  basketFingerprint: "fingerprint-alpha-release",
  deliveredAt: "2026-09-02T18:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [{ lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 2, unit: "pack" }],
};

function evidence() {
  const sealed = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "TESCO-RELEASE-001",
    retailer: "Tesco",
    capturedAt: "2026-09-02T18:10:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!sealed.ok) throw new Error("fixture failed to seal");
  return sealed.evidence;
}

function record() {
  const intent: AppendIntent = {
    eventType: "Delivery",
    item: "chicken-breast",
    occurredAt: delivery.deliveredAt,
    quantityDelta: 2,
    unit: "pack",
    source: "Human delivery evidence",
    actor: "James",
    entityType: "Delivery",
    entityReference: delivery.deliveryId,
    evidence: "sealed delivery evidence",
    confidence: "High",
    recordClass: "Production",
  };
  const result = canonicaliseAppend(intent, { now: () => "2026-09-02T18:11:00.000Z" });
  if (!result.ok) throw new Error("fixture failed to canonicalise");
  return result.record;
}

function approvalFor(eventId: string, payloadHash: string, overrides: Partial<AppendAuthorization> = {}): AppendAuthorization {
  return {
    authorizationId: "AUTH-RELEASE-001",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-09-02T18:12:00.000Z",
    evidenceSource: "EXPLICIT_USER_INPUT",
    evidenceDetail: "James approved this exact delivery event.",
    eventId,
    payloadHash,
    actionPolicyReference: "ACTION POLICY: explicit human approval",
    ...overrides,
  };
}

describe("delivery evidence approval release", () => {
  it("does not append without an exact approval", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const result = await releaseDeliveryEvidenceAppends({ evidence: evidence(), writer });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appended).toBe(0);
    expect(result.proposed).toBe(1);
    expect(result.written).toBe(false);
    expect(port.appended).toHaveLength(0);
  });

  it("requires the exact Event ID and payload hash for authorization", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const sealed = evidence();
    const prepared = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer, approvals: [] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const target = prepared.records[0]!;
    const wrongEvent = await releaseDeliveryEvidenceAppends({
      evidence: sealed,
      writer: createHouseholdEventWriter({ port: createFakeAppendPort() }),
      approvals: [approvalFor(`WRONG-${target.eventId}`, target.payloadHash)],
    });
    expect(wrongEvent.ok).toBe(true);
    if (!wrongEvent.ok) return;
    expect(wrongEvent.proposed).toBe(1);
    expect(wrongEvent.appended).toBe(0);

    const wrongHashPort = createFakeAppendPort();
    const wrongHash = await releaseDeliveryEvidenceAppends({
      evidence: sealed,
      writer: createHouseholdEventWriter({ port: wrongHashPort }),
      approvals: [approvalFor(target.eventId, "wrong-payload-hash")],
    });
    expect(wrongHash.ok).toBe(true);
    if (!wrongHash.ok) return;
    expect(wrongHash.rejected).toBe(1);
    expect(wrongHash.proposed).toBe(0);
    expect(wrongHashPort.appended).toHaveLength(0);
  });

  it("appends an exactly authorised event through the existing writer", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const sealed = evidence();
    const first = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const auth = approvalFor(first.records[0]!.eventId, first.records[0]!.payloadHash);
    const second = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer, approvals: [auth] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.appended).toBe(1);
    expect(second.rejected).toBe(0);
    expect(port.appended).toHaveLength(1);
    expect(second.receipts.find((r) => r.eventId === first.records[0]!.eventId)?.authorization?.authorizationId).toBe(auth.authorizationId);
    expect(second.receipts.find((r) => r.eventId === first.records[0]!.eventId)?.inventoryMutated).toBe(false);
  });

  it("is idempotent when the same authorised event is submitted again", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const sealed = evidence();
    const prepared = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const auth = approvalFor(prepared.records[0]!.eventId, prepared.records[0]!.payloadHash);

    const a = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer, approvals: [auth] });
    const b = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer, approvals: [auth] });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.appended).toBe(1);
    expect(b.duplicates).toBe(1);
    expect(b.written).toBe(false);
    expect(port.appended).toHaveLength(1);
  });

  it("never writes to a production connector in PROPOSE mode even when an approval is supplied", async () => {
    const port = {
      ...createFakeAppendPort(),
      provenance: "PRODUCTION" as const,
    };
    const writer = createHouseholdEventWriter({ mode: "PROPOSE", port });
    const sealed = evidence();
    const prepared = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const auth = approvalFor(prepared.records[0]!.eventId, prepared.records[0]!.payloadHash);
    const result = await releaseDeliveryEvidenceAppends({ evidence: sealed, writer, approvals: [auth] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toBe(false);
    expect(result.appended).toBe(0);
    expect(port.appended).toHaveLength(0);
  });
});
