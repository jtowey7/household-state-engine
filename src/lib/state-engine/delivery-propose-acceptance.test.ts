/**
 * Non-Production acceptance: RECONCILED DELIVERY -> PROPOSE_APPEND handoff.
 *
 * Proves that the existing delivery seam's events can be carried into the
 * existing PROPOSE-mode writer as canonical Receipt proposals only. No
 * connector, no authorization, no write, no INVENTORY mutation. Synthetic
 * fixtures only; Production household state is never involved.
 */

import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition, type ReconciledDelivery } from "./delivery-inventory";
import { proposeAppends } from "../event-writer/propose";

const delivery: ReconciledDelivery = {
  deliveryId: "DEL-SYNTH-001",
  dispatchId: "dispatch-synth-001",
  basketId: "basket-synth-001",
  basketVersion: 1,
  basketFingerprint: "basket-synth-fingerprint-v1",
  deliveredAt: "2026-08-30T09:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [
    { lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 2, unit: "pack" },
    { lineId: "L2", itemKey: "whole-milk", deliveredQuantity: 3, unit: "litre" },
    { lineId: "L3", itemKey: "limes", deliveredQuantity: 4, unit: "each", substituted: true },
  ],
};

const options = {
  now: () => "2026-08-30T10:00:00.000Z",
  actor: "Food OS delivery reconciliation",
  source: "Reconciled delivery (synthetic)",
};

function proposeForDelivery(existingEventIds: readonly string[] = []) {
  const transition = buildDeliveryInventoryTransition(delivery);
  return {
    transition,
    proposals: proposeAppends(transition.events, { ...options, existingEventIds }),
  };
}

describe("reconciled delivery -> PROPOSE_APPEND acceptance", () => {
  it("proposes one canonical Receipt row per delivered line and writes nothing", () => {
    const { transition, proposals } = proposeForDelivery();

    expect(transition.events).toHaveLength(3);
    expect(proposals).toHaveLength(3);

    for (const proposal of proposals) {
      expect(proposal.rejection).toBeNull();
      expect(proposal.record).not.toBeNull();
      expect(proposal.receipt).not.toBeNull();
      expect(proposal.requiresHumanAuthorization).toBe(true);
      expect(proposal.receipt?.outcome).toBe("PROPOSED");
      expect(proposal.receipt?.written).toBe(false);
      expect(proposal.receipt?.inventoryMutated).toBe(false);
      expect(proposal.receipt?.connector).toBeNull();
      expect(proposal.receipt?.authorization).toBeNull();
      expect(proposal.record?.row["Event type"]).toBe("Receipt");
      expect(proposal.record?.row["Record class"]).toBe("Production");
    }
  });

  it("preserves delivery provenance on every proposal", () => {
    const { transition, proposals } = proposeForDelivery();

    expect(proposals.map((p) => p.sourceEventId).sort()).toEqual(
      transition.events.map((e) => e.eventId).sort(),
    );
    for (const proposal of proposals) {
      expect(proposal.sourceEventId.startsWith("DELIVERY:")).toBe(true);
      const evidence = String(proposal.record?.row["Evidence"] ?? "");
      expect(evidence).toContain("source=RECONCILED_DELIVERY");
      expect(evidence).toContain(`deliveryId=${delivery.deliveryId}`);
    }
    const substituted = proposals.find((p) => p.record?.row["Item"] === "limes");
    expect(String(substituted?.record?.row["Evidence"])).toContain("substituted=true");
  });

  it("carries the delivered quantity and unit through unchanged", () => {
    const { proposals } = proposeForDelivery();
    const byItem = new Map(proposals.map((p) => [p.record?.row["Item"], p.record?.row]));

    expect(byItem.get("chicken-breast")?.["Quantity delta"]).toBe(2);
    expect(byItem.get("chicken-breast")?.["Unit"]).toBe("pack");
    expect(byItem.get("whole-milk")?.["Quantity delta"]).toBe(3);
    expect(byItem.get("limes")?.["Quantity delta"]).toBe(4);
  });

  it("is deterministic across repeated proposal runs", () => {
    const first = proposeForDelivery().proposals;
    const second = proposeForDelivery().proposals;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("never re-proposes a delivery event already present in the source", () => {
    const { transition } = proposeForDelivery();
    const already = transition.events[0]!.eventId;
    const { proposals } = proposeForDelivery([already]);

    expect(proposals).toHaveLength(2);
    expect(proposals.some((p) => p.sourceEventId === already)).toBe(false);
  });
});
