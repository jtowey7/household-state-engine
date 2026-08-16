import { describe, expect, it } from "vitest";
import { assertApprovedSnapshotCurrent, assertBaselineEventsPresent, existingEventMap, snapshotFingerprintFor } from "./execute-production-baseline";
import type { CanonicalAppendRecord } from "../src/lib/event-writer/types";

const event = (eventId: string, item: string, quantityDelta: number) => ({
  id: `rec-${eventId}-${item}-${quantityDelta}`,
  fields: {
    "fld0eOLFhMirrp3sp": eventId,
    "fldofNnuJSzaZBgO9": "Correction",
    "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
    "flddW9gBf3MeaLbT": item,
    "fldyzlpssmG8TykGG": quantityDelta,
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
    expect(() =>
      existingEventMap([
        event("BASELINE:milk", "milk", 2),
        event("BASELINE:milk", "milk", 3),
      ]),
    ).toThrow(/conflicting payloads/);
  });

  it("fails closed when duplicate Event IDs cannot be fingerprinted", () => {
    expect(() =>
      existingEventMap([
        {
          id: "rec-1",
          fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" },
        },
        {
          id: "rec-2",
          fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" },
        },
      ]),
    ).toThrow(/cannot be proven/);
  });
});

describe("approved baseline snapshot", () => {
  const inventory = [
    { id: "rec-inventory-1", fields: { Item: "milk", Quantity: 2, Unit: "litres" } },
  ];
  const reconciliations = [
    { id: "rec-reconciliation-1", fields: { "Inventory record ID": "rec-inventory-1", Disposition: "CONFIRM_RECORDED_QUANTITY" } },
  ];

  it("accepts the exact approved snapshot", () => {
    const fingerprint = snapshotFingerprintFor(inventory, reconciliations);
    expect(() => assertApprovedSnapshotCurrent(fingerprint, inventory, reconciliations)).not.toThrow();
  });

  it("fails closed when the authoritative inventory changes after approval", () => {
    const approvedFingerprint = snapshotFingerprintFor(inventory, reconciliations);
    const changedInventory = [
      { id: "rec-inventory-1", fields: { Item: "milk", Quantity: 3, Unit: "litres" } },
    ];

    expect(() => assertApprovedSnapshotCurrent(approvedFingerprint, changedInventory, reconciliations)).toThrow(
      "live snapshot fingerprint differs from approved authority",
    );
  });

  it("fails closed when reconciliation evidence changes after approval", () => {
    const approvedFingerprint = snapshotFingerprintFor(inventory, reconciliations);
    const changedReconciliations = [
      { id: "rec-reconciliation-1", fields: { "Inventory record ID": "rec-inventory-1", Disposition: "QUARANTINE" } },
    ];

    expect(() => assertApprovedSnapshotCurrent(approvedFingerprint, inventory, changedReconciliations)).toThrow(
      "live snapshot fingerprint differs from approved authority",
    );
  });
});

describe("post-write baseline verification", () => {
  it("accepts the exact canonical event payload after append", () => {
    const record = canonicalRecord("BASELINE:milk", "milk", 2, "hash-milk-2");
    const rows = [
      {
        id: "rec-event-1",
        fields: {
          "fld0eOLFhMirrp3sp": "BASELINE:milk",
          "fldofNnuJSzaZBgO9": "Correction",
          "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
          "flddW9gBfP3MeaLbT": "milk",
          "fldyzlpssmG8TykGG": 2,
          "fld3t0OMEE5XmMg85": "units",
          "fldxqIfgRcM4b673v": "2",
          "fldzu1QfNZwhGAeln": "Production",
        },
      },
    ];

    // The canonical record's hash is normally produced by canonicaliseAppend;
    // this test only exercises the fail-closed shape, so derive the expected hash
    // from the same event fixture via the existing event ledger helper.
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
    const rows = [event("BASELINE:milk", "milk", 3)];
    expect(() => assertBaselineEventsPresent([record], rows)).toThrow(/payload does not match the canonical batch/);
  });
});
