import { describe, expect, it } from "vitest";

import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter, type DispatchRecord, type DispatchReceiptStore } from "./dispatch-adapter";
import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R-PERSISTED-CONCURRENCY",
  snapshotId: "S-PERSISTED-CONCURRENCY",
  replayTimestamp: "2026-08-21T22:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-PERSISTED-CONCURRENCY",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      requirementId: "REQ-OATS-1",
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

function delayedStore(): DispatchReceiptStore & { setCalls: number } {
  const records = new Map<string, DispatchRecord>();
  let setCalls = 0;
  return {
    get: async (dispatchId) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return records.get(dispatchId);
    },
    set: async (dispatchId, record) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      setCalls += 1;
      records.set(dispatchId, record);
    },
    get setCalls() {
      return setCalls;
    },
  };
}

describe("TEST dispatch adapter: persisted-store concurrency", () => {
  it("serializes same-intent reuse when the receipt store is asynchronous", async () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: shadowCatalogue,
      retailer: "synthetic-grocer",
    });
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-21T22:01:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-21T22:02:00.000Z");
    const store = delayedStore();
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-21T22:03:00.000Z",
      now: "2026-08-21T22:04:00.000Z",
      receiptStore: store,
    });

    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => adapter.dispatch(intent, approval, basket)),
    );

    expect(store.setCalls).toBe(1);
    expect(new Set(receipts.map((receipt) => receipt.externalOrderId)).size).toBe(1);
  });
});
