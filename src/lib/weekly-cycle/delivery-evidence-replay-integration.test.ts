/**
 * Canonical delivery evidence -> REPLAY stage integration acceptance.
 *
 * Proves sealed delivery evidence enters the SAME deterministic replay input
 * used by projection/reconciled deliveries, that the resulting snapshot carries
 * the delivered stock into the QUANTITY REQUIREMENTS handoff, that duplicate
 * Event IDs are not double-counted, and that tampered evidence fails closed.
 *
 * TEST/pure: no Airtable I/O, no Production mutation, no approval, no dispatch.
 */

import { describe, expect, it } from "vitest";
import { runWeeklyShadowCycle } from "./cycle";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "./fixtures";
import { sealHumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import type { HumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import type { ReconciledDelivery } from "../state-engine/delivery-inventory";

const delivery: ReconciledDelivery = {
  deliveryId: "DEL-REPLAY-001",
  dispatchId: "dispatch-family-alpha-2026-08-29",
  basketId: "basket-family-alpha-v1",
  basketVersion: 1,
  basketFingerprint: "basket-fingerprint-v1",
  deliveredAt: "2026-08-03T09:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [{ lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 2, unit: "pack" }],
};

function sealedEvidence(): HumanDeliveryEvidence {
  const sealed = sealHumanDeliveryEvidence({
    basketId: "basket-family-alpha-v1",
    orderReference: "TESCO-ORDER-REPLAY-001",
    retailer: "Tesco",
    capturedAt: "2026-08-03T10:00:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!sealed.ok) throw new Error("fixture evidence failed to seal");
  return sealed.evidence;
}

function run(deliveryEvidence?: readonly HumanDeliveryEvidence[]) {
  return runWeeklyShadowCycle({
    port: weeklyPort,
    scope: weeklyScope,
    plan: weeklyPlan,
    asOf: weeklyAsOf,
    now: weeklyNow,
    ...(deliveryEvidence ? { deliveryEvidence } : {}),
  });
}

const onHand = (result: Awaited<ReturnType<typeof runWeeklyShadowCycle>>, itemKey: string) =>
  result.snapshot?.items.find((i) => i.itemKey === itemKey)?.quantity ?? 0;

describe("delivery evidence -> REPLAY stage integration", () => {
  it("changes the replayed inventory snapshot", async () => {
    const withoutEvidence = await run();
    const withEvidence = await run([sealedEvidence()]);

    expect(onHand(withEvidence, "chicken-breast")).toBeGreaterThan(
      onHand(withoutEvidence, "chicken-breast"),
    );
    expect(withEvidence.snapshot?.replayId).not.toBe(withoutEvidence.snapshot?.replayId);
  });

  it("carries the evidence-derived snapshot into the QUANTITY REQUIREMENTS handoff", async () => {
    const result = await run([sealedEvidence()]);
    const handoffItem = result.handoff?.items.find((i) => i.itemKey === "chicken-breast");

    expect(result.handoff?.snapshotId).toBe(result.snapshot?.snapshotId);
    expect(result.handoff?.replayId).toBe(result.snapshot?.replayId);
    expect(handoffItem?.quantity).toBe(onHand(result, "chicken-breast"));
  });

  it("does not double-count duplicate evidence Event IDs", async () => {
    const evidence = sealedEvidence();
    const once = await run([evidence]);
    const twice = await run([evidence, evidence]);

    expect(onHand(twice, "chicken-breast")).toBe(onHand(once, "chicken-breast"));
    expect(twice.snapshot?.snapshotId).toBe(once.snapshot?.snapshotId);
  });

  it("fails closed on tampered evidence without mutating Production", async () => {
    const evidence = sealedEvidence();
    const tampered: HumanDeliveryEvidence = {
      ...evidence,
      delivery: {
        ...evidence.delivery,
        lines: [{ lineId: "L1", itemKey: "chicken-breast", deliveredQuantity: 99, unit: "pack" }],
      },
    };
    const clean = await run();
    const result = await run([tampered]);

    expect(onHand(result, "chicken-breast")).toBe(onHand(clean, "chicken-breast"));
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
    const stage = result.stages.find((s) => s.stage === "RECEIVE_DELIVERY");
    expect(stage?.warnings.some((w) => w.startsWith("DELIVERY_EVIDENCE_REFUSED"))).toBe(true);
  });
});
