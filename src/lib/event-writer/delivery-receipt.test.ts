import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition } from "../state-engine/delivery-inventory";
import { mapHouseholdEventRows, type AirtableRow } from "../production-adapter/airtable-port";
import { replayEvents } from "../state-engine/engine";
import {
  authorizeAppend,
  createFakeAppendPort,
  createHouseholdEventWriter,
  canonicaliseAppend,
} from "./index";

describe("reconciled delivery -> canonical receipt write boundary", () => {
  it("preserves the delivered quantity, substitution provenance and replayed stock through the canonical writer", async () => {
    const transition = buildDeliveryInventoryTransition({
      deliveryId: "DEL-FA-RECEIPT-1",
      dispatchId: "dispatch-family-alpha-2026-08-29",
      basketId: "basket-family-alpha-v1",
      basketVersion: 1,
      basketFingerprint: "basket-fingerprint-v1",
      deliveredAt: "2026-09-02T10:00:00.000Z",
      reconciliationStatus: "RECONCILED",
      lines: [
        {
          lineId: "LINE-LIME-1",
          itemKey: "Tesco Limes 4 Pack",
          deliveredQuantity: 4,
          unit: "each",
          substituted: true,
        },
      ],
    });

    expect(transition.events).toHaveLength(1);
    const event = transition.events[0]!;
    expect(event.eventType).toBe("ITEM_STOCK_DELTA");
    expect(event.payload.quantity).toBe(4);
    expect(event.payload.unit).toBe("each");
    expect(event.payload.note).toContain("source=RECONCILED_DELIVERY");
    expect(event.payload.note).toContain("substituted=true");

    const appendIntent = {
      eventType: "Receipt" as const,
      item: event.itemKey,
      occurredAt: event.occurredAt,
      identityContext: event.eventId,
      quantityDelta: event.payload.quantity!,
      unit: event.payload.unit!,
      source: "RECONCILED_DELIVERY",
      actor: "Food OS reconciliation",
      entityType: "Inventory item" as const,
      entityReference: event.itemKey,
      evidence: event.payload.note!,
      confidence: "High" as const,
      recordClass: "Production" as const,
    };

    const canonical = canonicaliseAppend(appendIntent, {
      now: () => "2026-09-02T10:05:00.000Z",
    });
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;

    const release = authorizeAppend({
      record: canonical.record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "Reconciled Family Alpha delivery accepted for TEST projection",
    });
    expect(release.granted).toBe(true);
    if (!release.granted) return;

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: "PROPOSE", port });
    const receipt = await writer.append(canonical.record, release.authorization);

    expect(receipt.outcome).toBe("APPENDED_SYNTHETIC");
    expect(receipt.written).toBe(true);
    expect(receipt.inventoryMutated).toBe(false);
    expect(port.ledger()).toHaveLength(1);

    const written = port.ledger()[0]!.record;
    expect(written.eventId).toBe(canonical.record.eventId);
    expect(written.row["Quantity delta"]).toBe(4);
    expect(written.row.Evidence).toContain("substituted=true");
    expect(written.row.Evidence).toContain("deliveryId=DEL-FA-RECEIPT-1");
    expect(written.row["Record class"]).toBe("Production");
    expect(written.row["Event type"]).toBe("Receipt");

    const airtableRow: AirtableRow = {
      id: "recTESTDELIVERYRECEIPT",
      fields: { ...written.row, "Replay status": "Applied" },
    };
    const mapped = mapHouseholdEventRows([airtableRow]);
    expect(mapped.invalid).toHaveLength(0);
    const snapshot = replayEvents(mapped.events, {
      now: () => "2026-09-02T11:00:00.000Z",
    });
    const item = snapshot.items.find((candidate) => candidate.itemKey === event.itemKey);
    expect(item?.quantity).toBe(4);
    expect(item?.contributingEventIds).toContain(canonical.record.eventId);
  });

  it("is idempotent for the same delivery receipt and blocks conflicting reuse", async () => {
    const transition = buildDeliveryInventoryTransition({
      deliveryId: "DEL-FA-RECEIPT-2",
      dispatchId: "dispatch-family-alpha-2026-08-29",
      basketId: "basket-family-alpha-v1",
      basketVersion: 1,
      basketFingerprint: "basket-fingerprint-v1",
      deliveredAt: "2026-09-02T10:00:00.000Z",
      reconciliationStatus: "RECONCILED",
      lines: [
        {
          lineId: "LINE-CHICKEN-1",
          itemKey: "Tesco Chicken Fillets",
          deliveredQuantity: 1000,
          unit: "g",
        },
      ],
    });
    const event = transition.events[0]!;
    const canonical = canonicaliseAppend(
      {
        eventType: "Receipt",
        item: event.itemKey,
        occurredAt: event.occurredAt,
        identityContext: event.eventId,
        quantityDelta: event.payload.quantity!,
        unit: event.payload.unit!,
        source: "RECONCILED_DELIVERY",
        actor: "Food OS reconciliation",
        entityType: "Inventory item",
        entityReference: event.itemKey,
        evidence: event.payload.note!,
        confidence: "High",
        recordClass: "Production",
      },
      { now: () => "2026-09-02T10:05:00.000Z" },
    );
    if (!canonical.ok) throw new Error("fixture must canonicalise");
    const release = authorizeAppend({
      record: canonical.record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "Reconciled delivery accepted for TEST projection",
    });
    if (!release.granted) throw new Error("release must be granted");

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: "PROPOSE", port });
    const first = await writer.append(canonical.record, release.authorization);
    const second = await writer.append(canonical.record, release.authorization);

    expect(first.outcome).toBe("APPENDED_SYNTHETIC");
    expect(second.outcome).toBe("DUPLICATE_NOOP");
    expect(port.ledger()).toHaveLength(1);

    const conflict = {
      ...canonical.record,
      row: { ...canonical.record.row, "Quantity delta": 900 },
      payloadHash: `${canonical.record.payloadHash}-conflict`,
    };
    const rejected = await writer.append(conflict, {
      ...release.authorization,
      payloadHash: conflict.payloadHash,
    });
    expect(rejected.outcome).toBe("REJECTED");
    expect(rejected.rejection?.code).toBe("REUSED_EVENT_ID_PAYLOAD_CONFLICT");
    expect(port.ledger()).toHaveLength(1);
  });
});
