/**
 * RECEIVE_DELIVERY cycle-stage regression coverage.
 *
 * Proves the reconciled-delivery -> inventory materialisation seam now has a
 * production-shaped caller inside the shadow weekly cycle, without weakening
 * replay provenance, idempotency, conflict blocking, substitution handling or
 * Production write protection. Synthetic fixtures only.
 */

import { describe, expect, it } from "vitest";
import { runWeeklyShadowCycle } from "./cycle";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "./fixtures";
import type { ReconciledDelivery } from "../state-engine/delivery-inventory";

const delivery: ReconciledDelivery = {
  deliveryId: "DEL-CYCLE-001",
  dispatchId: "dispatch-family-alpha-2026-08-29",
  basketId: "basket-family-alpha-v1",
  basketVersion: 1,
  basketFingerprint: "basket-fingerprint-v1",
  deliveredAt: "2026-08-03T09:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [
    { lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 2, unit: "pack" },
    { lineId: "L2", itemKey: "limes", deliveredQuantity: 4, unit: "each", substituted: true },
  ],
};

const unreconciled = {
  ...delivery,
  deliveryId: "DEL-CYCLE-BAD",
  reconciliationStatus: "PENDING",
} as unknown as ReconciledDelivery;

function run(deliveries?: readonly ReconciledDelivery[]) {
  return runWeeklyShadowCycle({
    port: weeklyPort,
    scope: weeklyScope,
    plan: weeklyPlan,
    asOf: weeklyAsOf,
    now: weeklyNow,
    ...(deliveries ? { deliveries } : {}),
  });
}

const stageOf = (run: Awaited<ReturnType<typeof runWeeklyShadowCycle>>) =>
  run.stages.find((s) => s.stage === "RECEIVE_DELIVERY");

describe("weekly cycle RECEIVE_DELIVERY stage", () => {
  it("skips cleanly when no delivery is supplied", async () => {
    const result = await run();
    const stage = stageOf(result);
    expect(stage?.status).toBe("SKIPPED");
    expect(result.deliveryTransitions).toHaveLength(0);
  });

  it("receives a reconciled delivery as append-only stock receipts", async () => {
    const result = await run([delivery]);
    const stage = stageOf(result);

    expect(stage?.status).toBe("OK");
    expect(stage?.metrics["receiptEvents"]).toBe(2);
    expect(stage?.metrics["substitutedLines"]).toBe(1);
    expect(stage?.metrics["written"]).toBe(0);
    expect(stage?.metrics["mutatedProductionState"]).toBe(false);
    expect(result.deliveryTransitions).toHaveLength(1);
    expect(result.deliveryTransitions[0]?.deliveryId).toBe(delivery.deliveryId);
  });

  it("advances materialised stock and preserves DELIVERY provenance", async () => {
    const withoutDelivery = await run();
    const withDelivery = await run([delivery]);

    const before =
      withoutDelivery.snapshot?.items.find((i) => i.itemKey === "chicken-breast")?.quantity ?? 0;
    const after =
      withDelivery.snapshot?.items.find((i) => i.itemKey === "chicken-breast")?.quantity ?? 0;
    expect(after).toBe(before + 2);

    const chicken = withDelivery.snapshot?.items.find((i) => i.itemKey === "chicken-breast");
    expect(chicken?.contributingEventIds.some((id) => id.startsWith("DELIVERY:"))).toBe(true);
    expect(
      withDelivery.snapshot?.contributingEventIds.filter((id) => id.startsWith("DELIVERY:")),
    ).toHaveLength(2);
  });

  it("proposes delivery receipts for human authorisation without writing", async () => {
    const result = await run([delivery]);
    const deliveryProposals = result.appendProposals.filter((p) =>
      p.sourceEventId.startsWith("DELIVERY:"),
    );

    expect(deliveryProposals).toHaveLength(2);
    for (const proposal of deliveryProposals) {
      expect(proposal.record?.row["Event type"]).toBe("Receipt");
      expect(proposal.receipt?.outcome).toBe("PROPOSED");
      expect(proposal.receipt?.written).toBe(false);
      expect(proposal.receipt?.inventoryMutated).toBe(false);
      expect(proposal.receipt?.connector).toBeNull();
      expect(proposal.requiresHumanAuthorization).toBe(true);
    }
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("is idempotent when the same delivery is supplied twice in one cycle", async () => {
    const once = await run([delivery]);
    const twice = await run([delivery, { ...delivery }]);

    expect(stageOf(twice)?.status).toBe("WARNED");
    expect(stageOf(twice)?.metrics["duplicateReceipts"]).toBe(2);
    expect(twice.snapshot?.snapshotId).toBe(once.snapshot?.snapshotId);
    expect(twice.plan?.planId).toBe(once.plan?.planId);
  });

  it("refuses an unreconciled delivery instead of advancing stock", async () => {
    const result = await run([unreconciled]);
    const stage = stageOf(result);

    expect(stage?.status).toBe("WARNED");
    expect(stage?.metrics["refused"]).toBe(1);
    expect(stage?.metrics["receiptEvents"]).toBe(0);
    expect(result.deliveryTransitions).toHaveLength(0);
    expect(stage?.warnings.join(" ")).toContain("DELIVERY_REFUSED");
  });

  it("is deterministic across repeated cycle runs", async () => {
    const first = await run([delivery]);
    const second = await run([delivery]);
    expect(second.cycleId).toBe(first.cycleId);
    expect(second.snapshot?.replayId).toBe(first.snapshot?.replayId);
    expect(JSON.stringify(second.deliveryTransitions)).toBe(
      JSON.stringify(first.deliveryTransitions),
    );
  });
});
