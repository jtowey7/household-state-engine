/**
 * Sealed delivery evidence -> weekly-cycle invocation path acceptance coverage.
 *
 * Proves prepareDeliveryEvidenceHandoff() is wired into the real weekly-cycle
 * entrypoint (the same entrypoint the scheduler cycle calls), that canonical
 * HOUSEHOLD EVENTS append intents are produced with order/basket provenance,
 * that duplicate delivery of the same evidence is idempotent, and that
 * tampered/unsealed evidence fails closed before any append.
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
  deliveryId: "DEL-EVIDENCE-001",
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

function sealedEvidence(): HumanDeliveryEvidence {
  const sealed = sealHumanDeliveryEvidence({
    basketId: "basket-family-alpha-v1",
    orderReference: "TESCO-ORDER-ALPHA-001",
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

const stageOf = (result: Awaited<ReturnType<typeof runWeeklyShadowCycle>>) =>
  result.stages.find((s) => s.stage === "RECEIVE_DELIVERY");

describe("delivery evidence through the weekly-cycle invocation path", () => {
  it("accepts sealed evidence and produces canonical append intents", async () => {
    const evidence = sealedEvidence();
    const result = await run([evidence]);
    const stage = stageOf(result);

    expect(stage?.status).toBe("OK");
    expect(stage?.metrics["deliveryEvidence"]).toBe(1);
    expect(stage?.metrics["evidenceAccepted"]).toBe(1);
    expect(stage?.metrics["evidenceRefused"]).toBe(0);
    expect(stage?.metrics["evidenceIntents"]).toBe(2);
    expect(stage?.metrics["written"]).toBe(0);

    const proposals = result.appendProposals.filter((p) =>
      typeof p.record?.row?.Evidence === "string" &&
      (p.record.row.Evidence as string).includes(evidence.evidenceId),
    );
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.requiresHumanAuthorization).toBe(true);
      expect(p.record?.row["Event type"]).toBe("Delivery");
      expect(p.receipt?.written ?? false).toBe(false);
    }
  });

  it("preserves order/basket/delivery provenance on the intents", async () => {
    const evidence = sealedEvidence();
    const result = await run([evidence]);
    const evidenceText = result.appendProposals
      .map((p) => String(p.record?.row?.Evidence ?? ""))
      .filter((t) => t.includes(evidence.evidenceId))
      .join(" | ");

    expect(evidenceText).toContain("basket-family-alpha-v1");
    expect(evidenceText).toContain("dispatch-family-alpha-2026-08-29");
    expect(evidenceText).toContain("DEL-EVIDENCE-001");
  });

  it("is idempotent when the same evidence is delivered twice in one cycle", async () => {
    const evidence = sealedEvidence();
    const result = await run([evidence, { ...evidence }]);
    const stage = stageOf(result);

    expect(stage?.metrics["evidenceIntents"]).toBe(2);
    expect(stage?.metrics["duplicateEvidenceIntents"]).toBe(2);

    const eventIds = result.appendProposals.map((p) => p.record?.eventId).filter(Boolean);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });

  it("is deterministic across repeated invocations", async () => {
    const evidence = sealedEvidence();
    const a = await run([evidence]);
    const b = await run([evidence]);
    expect(a.appendProposals.map((p) => p.record?.eventId)).toEqual(
      b.appendProposals.map((p) => p.record?.eventId),
    );
  });

  it("fails closed on tampered evidence before any append intent is produced", async () => {
    const evidence = sealedEvidence();
    const tampered: HumanDeliveryEvidence = { ...evidence, basketId: "basket-other" };
    const result = await run([tampered]);
    const stage = stageOf(result);

    expect(stage?.status).toBe("WARNED");
    expect(stage?.metrics["evidenceAccepted"]).toBe(0);
    expect(stage?.metrics["evidenceRefused"]).toBe(1);
    expect(stage?.metrics["evidenceIntents"]).toBe(0);
    expect(stage?.warnings.some((w) => w.startsWith("DELIVERY_EVIDENCE_REFUSED"))).toBe(true);
    expect(
      result.appendProposals.some((p) =>
        String(p.record?.row?.Evidence ?? "").includes(evidence.evidenceId),
      ),
    ).toBe(false);
  });

  it("never mutates production, appends or dispatches on this path", async () => {
    const result = await run([sealedEvidence()]);
    expect(result.mutatedHouseholdState).toBe(false);
    expect(result.appendedEvents).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(result.approval.granted).toBe(false);
  });
});
