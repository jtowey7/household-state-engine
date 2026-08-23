import { describe, expect, it } from "vitest";
import { approveBasket, createBasketApproval, basketApprovalFingerprint } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter } from "./dispatch-adapter";
import { dispatchEvidence } from "./dispatch-test-evidence";
import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = { replayId: "R1", snapshotId: "S1", replayTimestamp: "2026-08-03T20:00:00.000Z", reconciliationStatus: "CLEAN", planId: "P1", eligibleForProcurement: true, executed: true, blockedItemKeys: [], rejections: [], requirements: [{ itemKey: "oats-rolled", requiredQuantity: 1200, unit: "g", onHandQuantity: 800, targetQuantity: 2000, sourceEventIds: ["OPEN-A", "EVT-1"], packSize: 500, packCount: 3, packRoundedQuantity: 1500 }] };
function approved() { const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" }); const approval = approveBasket(createBasketApproval(basket), basket, "James", "2026-08-17T12:00:00.000Z"); return { basket, approval, evidence: dispatchEvidence(basket) }; }

describe("TEST dispatch adapter receipt timestamp integrity", () => {
  it("rejects an invalid acceptedAt timestamp", async () => { const { basket, approval, evidence } = approved(); const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z", evidence); const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z", acceptedAt: "not-a-timestamp" }); await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("ACCEPTED_TIMESTAMP_INVALID"); });
  it("rejects an acceptedAt timestamp after execution", async () => { const { basket, approval, evidence } = approved(); const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z", evidence); const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z", acceptedAt: "2026-08-17T12:03:00.000Z" }); await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("ACCEPTED_TIMESTAMP_INVALID"); });
});
