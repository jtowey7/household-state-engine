import { describe, expect, it } from "vitest";
import { assertApprovedSnapshotCurrent, existingEventMap, snapshotFingerprintFor } from "./execute-production-baseline";

const event = (eventId: string, item: string, quantityDelta: number) => ({
  id: `rec-${eventId}-${item}-${quantityDelta}`,
  fields: {
    "fld0eOLFhMirrp3sp": eventId,
    "fldofNnuJSzaZBgO9": "Correction",
    "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
    "flddW9gBfP3MeaLbT": item,
    "fldyzlpssmG8TykGG": quantityDelta,
    "fld3t0OMEE5XmMg85": "units",
    "fldxqIfgRcM4b673v": String(quantityDelta),
    "fldzu1QfNZwhGAeln": "Production",
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
