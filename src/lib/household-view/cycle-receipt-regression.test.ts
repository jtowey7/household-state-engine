import { describe, expect, it } from "vitest";

import { describeCycle, describeReconciliation, type CycleInput } from "./cycle-state";
import { detectAppliedDeliveryReceipt, type DeliveryEventRow } from "./delivery-receipt";

/**
 * Regression: /cycle must derive its delivery/reconciliation state from the
 * canonical Applied delivery receipt evidence — never from approval, and
 * never from a hard-coded false that would hide an already-applied delivery.
 *
 * These tests compose the two seams exactly as the route does:
 *   getAppliedDeliveryReceipt evidence  →  receiptConfirmed  →  cycle view.
 */

const identity = { basketId: "basket-7-13-sep", basketVersion: 2, basketFingerprint: "fp-abc" };

function evidence(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    evidenceId: "EV-1",
    basketId: identity.basketId,
    basketVersion: identity.basketVersion,
    basketFingerprint: identity.basketFingerprint,
    deliveryId: "MANUAL-DELIVERY:basket-7-13-sep:2026-09-12T10:00:00.000Z",
    ...overrides,
  });
}

function appliedProductionRow(eventId: string, evidenceJson: string): DeliveryEventRow {
  return {
    eventId,
    recordClass: "Production",
    replayStatus: "Applied",
    occurredAt: "2026-09-12T10:00:00.000Z",
    evidence: evidenceJson,
  };
}

/** Mirror of the route wiring: receipt is set ONLY from the detection result. */
function cycleInputFromReceipt(
  rows: DeliveryEventRow[],
  approvals: { shopApproved: boolean; deliveryApproved: boolean },
): CycleInput {
  const detection = detectAppliedDeliveryReceipt(rows, identity);
  return {
    shopReady: true,
    shopApproved: approvals.shopApproved,
    deliveryKnown: true,
    deliveryApproved: approvals.deliveryApproved,
    receiptConfirmed: detection.confirmed,
  };
}

const planned = {
  retailer: "Tesco",
  lines: [
    { itemKey: "Kerrygold Butter 250G", quantity: 1, unit: "pack" },
    { itemKey: "Tesco Chicken Breast", quantity: 2, unit: "pack" },
  ],
};

describe("cycle receipt regression", () => {
  it("an already-applied exact basket shows Counted in", () => {
    const rows = [
      appliedProductionRow("EVT-1", evidence()),
      appliedProductionRow("EVT-2", `${evidence({ evidenceId: "EV-2" })} | approval:APR-1`),
    ];
    const input = cycleInputFromReceipt(rows, { shopApproved: true, deliveryApproved: true });

    expect(input.receiptConfirmed).toBe(true);
    const cycle = describeCycle(input);
    expect(cycle.stage).toBe("ALL_SETTLED");
    expect(cycle.tone).toBe("good");

    const reconciliation = describeReconciliation(input, planned);
    expect(reconciliation.headline).toBe("Counted in");
    expect(reconciliation.tone).toBe("good");
    expect(reconciliation.lines).toHaveLength(2);
  });

  it("an approved-but-unreceived basket remains unconfirmed", () => {
    // Basket fully approved on both seams, but no Applied receipt evidence exists.
    const input = cycleInputFromReceipt([], { shopApproved: true, deliveryApproved: true });

    expect(input.receiptConfirmed).toBe(false);
    const cycle = describeCycle(input);
    expect(cycle.stage).toBe("DELIVERY_TO_CONFIRM");
    expect(cycle.tone).toBe("attention");

    const reconciliation = describeReconciliation(input, planned);
    expect(reconciliation.headline).toBe("Not confirmed yet");
    expect(reconciliation.action).toEqual({ label: "Confirm what arrived", to: "/delivery" });
  });

  it("approval alone never flips the state even with a receipt-shaped basket present", () => {
    // Rows exist but none prove THIS exact basket: wrong fingerprint stays refused.
    const rows = [appliedProductionRow("EVT-9", evidence({ basketFingerprint: "fp-other" }))];
    const input = cycleInputFromReceipt(rows, { shopApproved: true, deliveryApproved: true });

    expect(input.receiptConfirmed).toBe(false);
    expect(describeCycle(input).stage).toBe("DELIVERY_TO_CONFIRM");
    expect(describeReconciliation(input, planned).headline).toBe("Not confirmed yet");
  });
});
