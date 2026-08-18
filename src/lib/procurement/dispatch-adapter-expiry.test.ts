import { describe, expect, it } from "vitest";

import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
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

describe("TEST dispatch adapter expiry boundary", () => {
  it("fails closed when execution occurs exactly at intent expiry", async () => {
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
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const adapter = createTestDispatchAdapter({
      now: intent.expiresAt,
      acceptedAt: intent.expiresAt,
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow(
      "DISPATCH_INTENT_EXPIRED",
    );
  });
});
