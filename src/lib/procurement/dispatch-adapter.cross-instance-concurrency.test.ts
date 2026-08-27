import { describe, expect, it } from "vitest";
import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter, type DispatchRecord, type DispatchReceiptStore } from "./dispatch-adapter";
import { dispatchEvidence } from "./dispatch-test-evidence";
import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R-CROSS-INSTANCE",
  snapshotId: "S-CROSS-INSTANCE",
  replayTimestamp: "2026-08-27T12:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-CROSS-INSTANCE",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [{
    requirementId: "REQ-MILK",
    itemKey: "milk-whole",
    requiredQuantity: 2,
    unit: "L",
    onHandQuantity: 4,
    targetQuantity: 6,
    sourceEventIds: ["EVT-MILK"],
    packSize: 1,
    packCount: 2,
    packRoundedQuantity: 2,
  }],
};

function delayedStore(): DispatchReceiptStore & { setCalls: number } {
  const records = new Map<string, DispatchRecord>();
  let setCalls = 0;
  return {
    get: async (id) => { await new Promise((resolve) => setTimeout(resolve, 5)); return records.get(id); },
    set: async (id, record) => { await new Promise((resolve) => setTimeout(resolve, 5)); setCalls += 1; records.set(id, record); },
    get setCalls() { return setCalls; },
  };
}

describe("TEST dispatch adapter: cross-instance concurrency", () => {
  it("serializes same-intent reuse when separate adapter instances share a receipt store", async () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" });
    const approval = approveBasket(createBasketApproval(basket), basket, "James", "2026-08-27T12:01:00.000Z");
    const intent = createDispatchIntent(approval, basket, "2026-08-27T12:02:00.000Z", dispatchEvidence(basket, "2026-08-27T12:02:00.000Z"));
    const store = delayedStore();
    const adapterA = createTestDispatchAdapter({ acceptedAt: "2026-08-27T12:03:00.000Z", now: "2026-08-27T12:04:00.000Z", receiptStore: store });
    const adapterB = createTestDispatchAdapter({ acceptedAt: "2026-08-27T12:03:00.000Z", now: "2026-08-27T12:04:00.000Z", receiptStore: store });

    const results = await Promise.allSettled([
      adapterA.dispatch(intent, approval, basket),
      adapterB.dispatch(intent, approval, basket),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(store.setCalls).toBe(1);
    const receipts = results.map((result) => result.status === "fulfilled" ? result.value : null);
    expect(new Set(receipts.map((receipt) => receipt?.externalOrderId)).size).toBe(1);
  });
});
