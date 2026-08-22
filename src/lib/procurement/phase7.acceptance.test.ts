import { describe, expect, it } from "vitest";
import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter } from "./dispatch-adapter";
import { dispatchEvidence } from "./dispatch-test-evidence";
import { aggregateCandidateBasket, shadowCatalogue } from "./index";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "PHASE7-ACCEPTANCE-R1", snapshotId: "PHASE7-ACCEPTANCE-S1", replayTimestamp: "2026-08-17T22:00:00.000Z",
  reconciliationStatus: "CLEAN", planId: "PHASE7-ACCEPTANCE-P1", eligibleForProcurement: true, executed: true, blockedItemKeys: [], rejections: [],
  requirements: [{ itemKey: "oats-rolled", requiredQuantity: 1200, unit: "g", onHandQuantity: 800, targetQuantity: 2000, sourceEventIds: ["PHASE7-ACCEPTANCE-EVT-1"], packSize: 500, packCount: 3, packRoundedQuantity: 1500 }],
};
function buildApprovedBasket() {
  const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" });
  const approval = approveBasket(createBasketApproval(basket), basket, "TEST-operator", "2026-08-17T22:01:00.000Z");
  return { basket, approval, evidence: dispatchEvidence(basket.totalCost, "2026-08-17T22:00:30.000Z") };
}

describe("Phase 7 Order/dispatch acceptance", () => {
  it("proves the complete TEST dispatch lifecycle remains non-retailer and idempotent", async () => {
    const { basket, approval, evidence } = buildApprovedBasket(); const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z", evidence);
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T22:03:00.000Z", now: "2026-08-17T22:03:00.000Z" });
    const first = await adapter.dispatch(intent, approval, basket); const repeat = await adapter.dispatch(intent, approval, basket);
    expect(basket.readyForApproval).toBe(true); expect(approval.status).toBe("APPROVED"); expect(intent.status).toBe("READY"); expect(intent.requiresExternalDispatch).toBe(true);
    expect(first.status).toBe("ACCEPTED"); expect(first.externalOrderId).toBe(`TEST-${intent.dispatchId}`); expect(repeat).toEqual(first);
  });
  it("fails closed for an expired dispatch intent", async () => {
    const { basket, approval, evidence } = buildApprovedBasket(); const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z", evidence);
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T22:17:00.000Z", now: "2026-08-17T22:17:00.000Z" });
    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("DISPATCH_INTENT_EXPIRED");
  });
  it("fails closed when a dispatch receipt is future-dated", async () => {
    const { basket, approval, evidence } = buildApprovedBasket(); const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z", evidence);
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T22:04:00.000Z", now: "2026-08-17T22:03:00.000Z" });
    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("ACCEPTED_TIMESTAMP_INVALID");
  });
  it("requires human approval before a dispatch intent can exist", () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" }); const unapproved = createBasketApproval(basket);
    expect(() => createDispatchIntent(unapproved, basket, "2026-08-17T22:02:00.000Z", dispatchEvidence(basket.totalCost, "2026-08-17T22:00:30.000Z"))).toThrow("NOT_APPROVED");
  });
});
