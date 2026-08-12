/**
 * Exact salmon synthetic vertical: opening 780g -> planned meal completion ->
 * prepared Consumption row (-780) -> preview -> authorised append to the FAKE
 * port only -> replay yields 0g.
 *
 * Everything here is synthetic. No Airtable connection, no credential, no
 * production write.
 */

import { describe, expect, it } from "vitest";
import {
  authorizeAppend,
  canonicaliseAppend,
  createFakeAppendPort,
  createHouseholdEventWriter,
  prepareAppend,
  previewAppend,
} from "./index";
import type { AppendIntent } from "../write-boundary/types";
import { mapHouseholdEventRows, type AirtableRow } from "../production-adapter/airtable-port";
import { replayEvents } from "../state-engine/engine";
import type { HouseholdEventRowDraft } from "../write-boundary/types";

const SALMON = "Tesco 6 Boneless Salmon Fillets 780G";
const now = () => "2026-08-12T08:00:00.000Z";

const openingRow: AirtableRow = {
  id: "recSALMONOPEN",
  fields: {
    "Event ID": "EVT-TEST-SALMON-OPENING",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T08:30:00.000Z",
    "Recorded at": "2026-08-11T08:35:00.000Z",
    Source: "Synthetic fixture",
    Actor: "Test harness",
    "Entity type": "Inventory item",
    "Entity reference": "INV-SALMON-780G",
    Item: SALMON,
    "Quantity delta": 780,
    Unit: "g",
    Evidence: "synthetic opening stock",
    "State before": "0",
    "State after": "780",
    Confidence: "High",
    "Supersedes event ID": [],
    "Exception / reconciliation action": "",
    "Replay status": "Applied",
    "Record class": "Production",
  },
};

/** The consumption implied by the planned Tuesday salmon meal completing. */
const plannedConsumption: AppendIntent = {
  eventType: "Consumption",
  item: SALMON,
  occurredAt: "2026-08-11T18:30:00.000Z",
  quantityDelta: -780,
  unit: "g",
  source: "Planned meal completion (synthetic)",
  actor: "Food OS state engine",
  entityType: "Inventory item",
  entityReference: "INV-SALMON-780G",
  evidence: "Planned meal 'Tuesday salmon' reached completion",
  confidence: "High",
  recordClass: "Production",
};

function asAirtableRow(row: HouseholdEventRowDraft, id: string): AirtableRow {
  return { id, fields: { ...row, "Replay status": "Applied" } };
}

describe("salmon synthetic vertical — prepare, preview, authorised fake append, replay", () => {
  it("prepares a Consumption row with Quantity delta = -780 and previews the exact Airtable row", () => {
    const prepared = prepareAppend(plannedConsumption, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const { preview, wouldWrite, record } = prepared.prepared;
    expect(wouldWrite).toBe(false);
    expect(preview.row["Event type"]).toBe("Consumption");
    expect(preview.row["Quantity delta"]).toBe(-780);
    expect(preview.row.Unit).toBe("g");
    expect(preview.row.Item).toBe(SALMON);
    expect(preview.row["Record class"]).toBe("Production");
    expect(preview.row["Event ID"]).toBe(record.eventId);
    expect(preview.request.method).toBe("POST");
    expect(preview.request.tableLabel).toBe("HOUSEHOLD EVENTS");
    expect(preview.request.body.records[0].fields).toEqual(preview.row);
    expect(Object.keys(preview.row)).toHaveLength(19);
  });

  it("preview is deterministic and never touches a port", async () => {
    const port = createFakeAppendPort();
    const a = previewAppend(plannedConsumption, { now });
    const b = previewAppend(plannedConsumption, { now });
    expect(a).toEqual(b);
    expect(port.ledger()).toHaveLength(0);
    expect(port.appended).toHaveLength(0);
  });

  it("explicit authorization allows an append to the FAKE port only, and replay yields 0g", async () => {
    const canonical = canonicaliseAppend(plannedConsumption, { now });
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;

    const release = authorizeAppend({
      record: canonical.record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "James confirmed the Tuesday salmon meal was eaten in full",
    });
    expect(release.granted).toBe(true);
    if (!release.granted) return;

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: release.writerMode, port });
    const receipt = await writer.append(canonical.record, release.authorization);

    expect(receipt.outcome).toBe("APPENDED_SYNTHETIC");
    expect(receipt.written).toBe(true);
    expect(receipt.connector?.provenance).toBe("SYNTHETIC");
    expect(receipt.inventoryMutated).toBe(false);
    expect(receipt.payloadHash).toBe(canonical.record.payloadHash);
    expect(port.ledger()).toHaveLength(1);

    const appendedRow = asAirtableRow(port.ledger()[0].record.row, "recSALMONCONSUME");
    const mapped = mapHouseholdEventRows([openingRow, appendedRow]);
    expect(mapped.invalid).toHaveLength(0);
    const snapshot = replayEvents(mapped.events, { replayedAt: now() });
    const item = snapshot.items.find((i) => i.itemKey === SALMON);
    expect(item?.quantity).toBe(0);
    expect(item?.unit).toBe("g");
    expect(item?.contributingEventIds).toContain(canonical.record.eventId);
  });

  it("identical second append is idempotent; a changed payload under the same ID conflicts", async () => {
    const canonical = canonicaliseAppend(plannedConsumption, { now });
    if (!canonical.ok) throw new Error("fixture must canonicalise");
    const release = authorizeAppend({
      record: canonical.record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "confirmed",
    });
    if (!release.granted) throw new Error("release must be granted");

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: "PROPOSE", port });
    const first = await writer.append(canonical.record, release.authorization);
    const second = await writer.append(canonical.record, release.authorization);

    expect(first.outcome).toBe("APPENDED_SYNTHETIC");
    expect(second.outcome).toBe("DUPLICATE_NOOP");
    expect(second.written).toBe(false);
    expect(port.ledger()).toHaveLength(1);

    // The port itself is idempotent even if a caller bypasses the writer.
    const ack = await port.append(canonical.record);
    expect(ack.duplicate).toBe(true);
    expect(port.ledger()).toHaveLength(1);

    // Same Event ID, different canonical payload: hard conflict, no ledger entry.
    const forged = {
      ...canonical.record,
      row: { ...canonical.record.row, "Quantity delta": -500 },
      payloadHash: `${canonical.record.payloadHash}-changed`,
    };
    await expect(port.append(forged)).rejects.toThrow(/append-only/i);
    expect(port.ledger()).toHaveLength(1);

    const conflictReceipt = await writer.append(forged, {
      ...release.authorization,
      payloadHash: forged.payloadHash,
    });
    expect(conflictReceipt.outcome).toBe("REJECTED");
    expect(conflictReceipt.rejection?.code).toBe("REUSED_EVENT_ID_PAYLOAD_CONFLICT");
    expect(conflictReceipt.written).toBe(false);
    expect(port.ledger()).toHaveLength(1);
  });

  it("supports a Correction with State after = 0 and blocks a conflicting reuse of its ID", async () => {
    const correction: AppendIntent = {
      eventType: "Correction",
      item: SALMON,
      occurredAt: "2026-08-11T20:00:00.000Z",
      stateAfter: 0,
      unit: "g",
      source: "Exception correction (synthetic)",
      actor: "James",
      evidence: "James stated the salmon is gone",
      recordClass: "Production",
    };
    const prepared = prepareAppend(correction, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.preview.row["Event type"]).toBe("Correction");
    expect(prepared.prepared.preview.row["State after"]).toBe("0");
    expect(prepared.prepared.preview.row["Quantity delta"]).toBeNull();

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: "PROPOSE", port });
    const release = authorizeAppend({
      record: prepared.prepared.record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "stated in chat",
    });
    if (!release.granted) throw new Error("release must be granted");
    const receipt = await writer.append(prepared.prepared.record, release.authorization);
    expect(receipt.outcome).toBe("APPENDED_SYNTHETIC");

    const mapped = mapHouseholdEventRows([
      openingRow,
      asAirtableRow(port.ledger()[0].record.row, "recSALMONCORRECT"),
    ]);
    const snapshot = replayEvents(mapped.events, { replayedAt: now() });
    expect(snapshot.items.find((i) => i.itemKey === SALMON)?.quantity).toBe(0);

    const forged = {
      ...prepared.prepared.record,
      row: { ...prepared.prepared.record.row, "State after": "300" },
      payloadHash: `${prepared.prepared.record.payloadHash}-changed`,
    };
    const conflict = await writer.append(forged, {
      ...release.authorization,
      payloadHash: forged.payloadHash,
    });
    expect(conflict.outcome).toBe("REJECTED");
    expect(conflict.rejection?.code).toBe("REUSED_EVENT_ID_PAYLOAD_CONFLICT");
    expect(port.ledger()).toHaveLength(1);
  });
});
