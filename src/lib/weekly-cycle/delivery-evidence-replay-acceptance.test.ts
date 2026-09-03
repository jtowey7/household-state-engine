import { describe, expect, it } from "vitest";
import { runWeeklyShadowCycle } from "./cycle";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "./fixtures";
import { prepareDeliveryEvidenceHandoff } from "../state-engine/delivery-evidence-handoff";
import { sealHumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import type { HumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import type { ReconciledDelivery } from "../state-engine/delivery-inventory";

const delivery: ReconciledDelivery = {
  deliveryId: "DEL-REPLAY-ACCEPTANCE-001",
  dispatchId: "dispatch-replay-acceptance-001",
  basketId: "basket-replay-acceptance-001",
  basketVersion: 1,
  basketFingerprint: "fingerprint-replay-acceptance-001",
  deliveredAt: "2026-09-02T19:00:00.000Z",
  reconciliationStatus: "RECONCILED",
  lines: [
    { lineId: "L1", itemKey: "delivery-replay-chicken", deliveredQuantity: 2, unit: "pack" },
  ],
};

function sealedEvidence(): HumanDeliveryEvidence {
  const result = sealHumanDeliveryEvidence({
    basketId: delivery.basketId,
    orderReference: "TESCO-REPLAY-ACCEPTANCE-001",
    retailer: "Tesco",
    capturedAt: "2026-09-02T19:05:00.000Z",
    capturedBy: "James",
    delivery,
  });
  if (!result.ok) throw new Error("fixture evidence failed to seal");
  return result.evidence;
}

describe("sealed delivery evidence -> weekly replay -> quantity", () => {
  it("replays evidence-derived HOUSEHOLD EVENTS into the same snapshot and quantity handoff", async () => {
    const evidence = sealedEvidence();
    const handoff = prepareDeliveryEvidenceHandoff(evidence, weeklyNow);
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const result = await runWeeklyShadowCycle({
      port: weeklyPort,
      scope: weeklyScope,
      plan: weeklyPlan,
      asOf: weeklyAsOf,
      now: weeklyNow,
      deliveryEvidence: [evidence],
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.snapshot).not.toBeNull();
    expect(result.handoff).not.toBeNull();

    const evidenceEventIds = handoff.records.map((record) => record.eventId);
    for (const eventId of evidenceEventIds) {
      expect(result.snapshot!.contributingEventIds).toContain(eventId);
    }

    expect(result.snapshot!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "delivery-replay-chicken", quantity: 2, unit: "pack" }),
    ]));
    expect(result.handoff!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: "delivery-replay-chicken", quantity: 2, unit: "pack" }),
    ]));
  });

  it("deduplicates the same evidence against the reconciled delivery path by stable Event ID", async () => {
    const evidence = sealedEvidence();
    const evidenceHandoff = prepareDeliveryEvidenceHandoff(evidence, weeklyNow);
    expect(evidenceHandoff.ok).toBe(true);
    if (!evidenceHandoff.ok) return;

    const result = await runWeeklyShadowCycle({
      port: weeklyPort,
      scope: weeklyScope,
      plan: weeklyPlan,
      asOf: weeklyAsOf,
      now: weeklyNow,
      deliveries: [delivery],
      deliveryEvidence: [evidence],
    });

    expect(result.status).toBe("COMPLETED");
    const replay = result.stages.find((stage) => stage.stage === "REPLAY");
    expect(replay?.status).not.toBe("REFUSED");
    expect(result.snapshot!.items.filter((item) => item.itemKey === "delivery-replay-chicken")).toHaveLength(1);
    expect(result.snapshot!.items.find((item) => item.itemKey === "delivery-replay-chicken")?.quantity).toBe(2);
  });
});
