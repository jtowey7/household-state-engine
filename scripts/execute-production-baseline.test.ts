import { describe, expect, it } from "vitest";
import { assertProductionBaselineActionPolicy, assertApprovedSnapshotCurrent, assertBaselineEventsPresent, assertExistingBaselineLedgerCurrent, executeProductionBaseline, existingEventMap, snapshotFingerprintFor } from "./execute-production-baseline";
import { PRODUCTION_BASELINE_ACTION } from "../src/lib/event-writer/baseline-authorization";
import { canonicaliseAppend } from "../src/lib/event-writer/canonical";
import type { CanonicalAppendRecord } from "../src/lib/event-writer/types";

const event = (eventId: string, item: string, quantityDelta: number, source = "") => ({
  id: `rec-${eventId}-${item}-${quantityDelta}`,
  fields: {
    "fld0eOLFhMirrp3sp": eventId,
    "fldofNnuJSzaZBgO9": "Correction",
    "fldhp8eZbne3u1peN": source,
    "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
    "flddW9gBfP3MeaLbT": item,
    "fldyzlpssmG8TykGG": null,
    "fld3t0OMEE5XmMg85": "units",
    "fldxqIfgRcM4b673v": String(quantityDelta),
    "fldzu1QfNZwhGAeln": "Production",
  },
});

const canonicalRecord = (eventId: string, item: string, quantityDelta: number, payloadHash: string): CanonicalAppendRecord => ({
  eventId,
  payloadHash,
  row: {
    "Event ID": eventId,
    "Event type": "Correction",
    "Occurred at": "2026-08-16T00:00:00.000Z",
    Item: item,
    "Quantity delta": quantityDelta,
    Unit: "units",
    "State after": String(quantityDelta),
    "Record class": "Production",
  },
});

describe("existingEventMap", () => {
  it("coalesces identical duplicate Event IDs", () => {
    const result = existingEventMap([
      event("BASELINE:milk", "milk", 2),
      event("BASELINE:milk", "milk", 2),
    ]);
    expect(result.size).toBe(1);
  });

  it("rejects conflicting duplicate Event IDs instead of letting the last row win", () => {
    expect(() => existingEventMap([
      event("BASELINE:milk", "milk", 2),
      event("BASELINE:milk", "milk", 3),
    ])).toThrow(/conflicting payloads/);
  });

  it("fails closed when duplicate Event IDs cannot be fingerprinted", () => {
    expect(() => existingEventMap([
      { id: "rec-1", fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" } },
      { id: "rec-2", fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" } },
    ])).toThrow(/cannot be proven/);
  });

  it("reconstructs the stable identity payload for an existing baseline event", () => {
    const eventId = "BASELINE:milk";
    const expected = canonicaliseAppend({
      eventType: "Correction",
      item: "milk",
      occurredAt: "2026-08-16T00:00:00.000Z",
      identityContext: eventId,
      stateAfter: 2,
      unit: "units",
      source: "INVENTORY_SNAPSHOT",
      actor: "Food OS baseline initialisation",
      entityType: "Inventory item",
      evidence: "baseline:milk",
      confidence: "Confirmed",
      recordClass: "Production",
    }, { now: () => "2026-08-16T00:00:00.000Z" });
    if (!expected.ok) throw new Error(expected.rejection.detail);

    const rows = [event(eventId, "milk", 2, "INVENTORY_SNAPSHOT")];
    expect(existingEventMap(rows).get(eventId)).toBe(expected.record.payloadHash);
  });

  it("keeps ordinary production corrections timestamp-bound", () => {
    const first = existingEventMap([event("EVT-ordinary", "milk", 2, "MANUAL")]).get("EVT-ordinary");
    const changed = existingEventMap([{
      ...event("EVT-ordinary", "milk", 2, "MANUAL"),
      fields: { ...event("EVT-ordinary", "milk", 2, "MANUAL").fields, "fldllmvZqSOV8wRVB": "2026-08-17T00:00:00.000Z" },
    }]).get("EVT-ordinary");
    expect(first).not.toBe(changed);
  });
});

describe("approved baseline snapshot", () => {
  const inventory = [{ id: "rec-inventory-1", fields: { Item: "milk", Quantity: 2, Unit: "litres" } }];
  const reconciliations = [{ id: "rec-reconciliation-1", fields: { "Inventory record ID": "rec-inventory-1", Disposition: "CONFIRM_RECORDED_QUANTITY" } }];

  it("accepts the exact approved snapshot", () => {
    const fingerprint = snapshotFingerprintFor(inventory, reconciliations);
    expect(() => assertApprovedSnapshotCurrent(fingerprint, inventory, reconciliations)).not.toThrow();
  });

  it("fails closed when the authoritative inventory changes after approval", () => {
    const approvedFingerprint = snapshotFingerprintFor(inventory, reconciliations);
    const changedInventory = [{ id: "rec-inventory-1", fields: { Item: "milk", Quantity: 3, Unit: "litres" } }];
    expect(() => assertApprovedSnapshotCurrent(approvedFingerprint, changedInventory, reconciliations)).toThrow("live snapshot fingerprint differs from approved authority");
  });

  it("fails closed when reconciliation evidence changes after approval", () => {
    const approvedFingerprint = snapshotFingerprintFor(inventory, reconciliations);
    const changedReconciliations = [{ id: "rec-reconciliation-1", fields: { "Inventory record ID": "rec-inventory-1", Disposition: "QUARANTINE" } }];
    expect(() => assertApprovedSnapshotCurrent(approvedFingerprint, inventory, changedReconciliations)).toThrow("live snapshot fingerprint differs from approved authority");
  });
});

describe("production baseline action policy", () => {
  it("accepts only the exact canonical ACTION POLICY reference", () => {
    expect(() => assertProductionBaselineActionPolicy({ FOODOS_BASELINE_ACTION_POLICY_REFERENCE: PRODUCTION_BASELINE_ACTION })).not.toThrow();
  });

  it("rejects a caller-supplied lookalike action policy reference", () => {
    expect(() => assertProductionBaselineActionPolicy({
      FOODOS_BASELINE_ACTION_POLICY_REFERENCE: "Initialise Production HOUSEHOLD EVENTS from current INVENTORY snapshot — APPROVED",
    })).toThrow("ACTION POLICY reference does not match the exact approved baseline action");
  });
});

describe("pre-append baseline ledger verification", () => {
  it("rejects a conflicting Event ID that appears after the initial ledger read", () => {
    const record = canonicalRecord("BASELINE:milk", "milk", 2, "hash-milk-2");
    const expected = new Map<string, string | null>();
    expect(() => assertExistingBaselineLedgerCurrent([record], expected, [event("BASELINE:milk", "milk", 3)])).toThrow(/appeared with a conflicting payload before append/);
  });

  it("rejects an existing Event ID whose payload changes before append", () => {
    const beforeRows = [event("BASELINE:milk", "milk", 2)];
    const afterRows = [event("BASELINE:milk", "milk", 3)];
    const expected = existingEventMap(beforeRows);
    const record = canonicalRecord("BASELINE:milk", "milk", 2, expected.get("BASELINE:milk")!);
    expect(() => assertExistingBaselineLedgerCurrent([record], expected, afterRows)).toThrow(/existing Event ID BASELINE:milk changed before append/);
  });

  it("allows an Event ID to appear with the exact canonical payload before append", () => {
    const record = canonicalRecord("BASELINE:milk", "milk", 2, "hash-milk-2");
    const latestRows = [event("BASELINE:milk", "milk", 2)];
    const actualHash = existingEventMap(latestRows).get("BASELINE:milk")!;
    const expected = new Map<string, string | null>();
    expect(() => assertExistingBaselineLedgerCurrent([{ ...record, payloadHash: actualHash }], expected, latestRows)).not.toThrow();
  });
});

describe("post-write baseline verification", () => {
  it("accepts the exact canonical event payload after append", () => {
    const record = canonicalRecord("BASELINE:milk", "milk", 2, "hash-milk-2");
    const rows = [{ id: "rec-event-1", fields: {
      "fld0eOLFhMirrp3sp": "BASELINE:milk",
      "fldofNnuJSzaZBgO9": "Correction",
      "fldhp8eZbne3u1peN": "INVENTORY_SNAPSHOT",
      "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
      "flddW9gBfP3MeaLbT": "milk",
      "fldyzlpssmG8TykGG": null,
      "fld3t0OMEE5XmMg85": "units",
      "fldxqIfgRcM4b673v": "2",
      "fldzu1QfNZwhGAeln": "Production",
    }}];
    const existing = existingEventMap(rows);
    const actualHash = existing.get(record.eventId);
    expect(actualHash).toBeTruthy();
    expect(() => assertBaselineEventsPresent([{ ...record, payloadHash: actualHash! }], rows)).not.toThrow();
  });

  it("fails closed when an expected Event ID is absent after append", () => {
    const record = canonicalRecord("BASELINE:missing", "milk", 2, "hash-missing");
    expect(() => assertBaselineEventsPresent([record], [])).toThrow(/Event ID BASELINE:missing is missing after append/);
  });

  it("fails closed when an appended Event ID has a different payload", () => {
    const record = canonicalRecord("BASELINE:milk", "milk", 2, "hash-does-not-match");
    expect(() => assertBaselineEventsPresent([record], [event("BASELINE:milk", "milk", 3)])).toThrow(/payload does not match the canonical batch/);
  });
});

describe("production baseline authorization", () => {
  it("refuses before any Airtable read when explicit one-time confirmation is absent", async () => {
    let fetchCalls = 0;
    await expect(executeProductionBaseline({}, async () => {
      fetchCalls += 1;
      throw new Error("Airtable should not be reached without authorization");
    })).rejects.toThrow("Production baseline is fail-closed; explicit one-time confirmation is required.");
    expect(fetchCalls).toBe(0);
  });

  it("refuses before any Airtable read when the evidence source is invalid", async () => {
    let fetchCalls = 0;
    await expect(executeProductionBaseline({
      FOODOS_BASELINE_EXECUTE: "CONFIRM_ONE_TIME_BASELINE",
      FOODOS_BASELINE_ACTION_POLICY_REFERENCE: PRODUCTION_BASELINE_ACTION,
      AIRTABLE_API_KEY: "test-token",
      AIRTABLE_BASE_ID: "appmqDptH3taN8uby",
      FOODOS_BASELINE_TIMESTAMP: "2026-08-17T06:00:00.000Z",
      FOODOS_BASELINE_SNAPSHOT_FINGERPRINT: "snapshot",
      FOODOS_BASELINE_BATCH_FINGERPRINT: "batch",
      FOODOS_BASELINE_SNAPSHOT_ID: "snapshot-id",
      FOODOS_BASELINE_EVENT_COUNT: "1",
      FOODOS_BASELINE_EVIDENCE_SOURCE: "UNTRUSTED_SOURCE",
    }, async () => {
      fetchCalls += 1;
      throw new Error("Airtable should not be reached with invalid evidence source");
    })).rejects.toThrow("Invalid production baseline evidence source.");
    expect(fetchCalls).toBe(0);
  });
});
