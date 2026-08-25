import { describe, expect, it } from "vitest";

import { approveBasket, basketApprovalFingerprint, createBasketApproval } from "./approval";
import {
  createDispatchIntent,
  SUBMIT_GROCERY_ORDER_POLICY_ID,
  SUBMIT_GROCERY_ORDER_POLICY_VERSION,
  type DispatchEvidence,
} from "./dispatch";
import { createTestDispatchAdapter } from "./dispatch-adapter";
import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R1",
  snapshotId: "S1",
  replayTimestamp: "2026-08-03T20:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P1",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      itemKey: "oats-rolled",
      requiredQuantity: 1200,
      unit: "g",
      onHandQuantity: 800,
      targetQuantity: 2000,
      sourceEventIds: ["OPEN-A", "EVT-1"],
      packSize: 500,
      packCount: 3,
      packRoundedQuantity: 1500,
    },
  ],
};

function evidence(basket: ReturnType<typeof aggregateCandidateBasket>): DispatchEvidence {
  return {
    policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
    policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
    basketFingerprint: basketApprovalFingerprint(basket),
    deliverySlot: {
      slotId: "SLOT-001",
      retailer: "synthetic-grocer",
      startsAt: "2026-08-17T18:00:00.000Z",
      endsAt: "2026-08-17T19:00:00.000Z",
      recordedAt: "2026-08-17T12:00:30.000Z",
    },
    substitutions: {
      decisionId: "SUB-001",
      outcome: "NONE",
      recordedAt: "2026-08-17T12:00:30.000Z",
    },
    spendPolicy: {
      decisionId: "SPEND-001",
      totalCost: basket.totalCost,
      outcome: "WITHIN_POLICY",
      recordedAt: "2026-08-17T12:00:30.000Z",
    },
  };
}

function buildDispatch() {
  const basket = aggregateCandidateBasket(plan, {
    catalogue: shadowCatalogue,
    retailer: "synthetic-grocer",
  });
  const approval = approveBasket(
    createBasketApproval(basket),
    basket,
    "James",
    "2026-08-17T12:00:00.000Z",
  );
  const intent = createDispatchIntent(
    approval,
    basket,
    "2026-08-17T12:01:00.000Z",
    evidence(basket),
  );
  return { basket, approval, intent };
}

describe("TEST dispatch adapter expiry boundary", () => {
  it("fails closed when execution occurs exactly at intent expiry", async () => {
    const { basket, approval, intent } = buildDispatch();
    const adapter = createTestDispatchAdapter({
      now: intent.expiresAt,
      acceptedAt: intent.expiresAt,
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow(
      "DISPATCH_INTENT_EXPIRED",
    );
  });

  it("returns the accepted receipt when an identical retry arrives after intent expiry", async () => {
    const { basket, approval, intent } = buildDispatch();
    const receiptStore = new Map();
    const first = createTestDispatchAdapter({
      now: "2026-08-17T12:02:00.000Z",
      acceptedAt: "2026-08-17T12:02:00.000Z",
      receiptStore,
    });
    const originalReceipt = await first.dispatch(intent, approval, basket);

    const retry = createTestDispatchAdapter({
      now: "2026-08-17T12:17:00.000Z",
      acceptedAt: "2026-08-17T12:17:00.000Z",
      receiptStore,
    });
    await expect(retry.dispatch(intent, approval, basket)).resolves.toEqual(originalReceipt);
  });
});
