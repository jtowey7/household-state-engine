import { describe, expect, it } from "vitest";

import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter, type DispatchRecord } from "./dispatch-adapter";
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

function approvedBasket() {
  return aggregateCandidateBasket(plan, {
    catalogue: shadowCatalogue,
    retailer: "synthetic-grocer",
  });
}

describe("Phase 7 dispatch receipt serialization", () => {
  it("reconstructs a serialized receipt store and reuses it idempotently in a fresh adapter", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");

    const originalStore = new Map<string, DispatchRecord>();
    const firstAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      receiptStore: originalStore,
    });

    const first = await firstAdapter.dispatch(intent, approval, basket);

    const serialized = JSON.stringify([...originalStore.entries()]);
    const reconstructedStore = new Map<string, DispatchRecord>(
      JSON.parse(serialized) as [string, DispatchRecord][],
    );
    const secondAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      receiptStore: reconstructedStore,
    });

    const afterReconstruction = await secondAdapter.dispatch(intent, approval, basket);

    expect(afterReconstruction).toEqual(first);
    expect(reconstructedStore.size).toBe(1);
    expect(reconstructedStore.get(intent.dispatchId)).toEqual(originalStore.get(intent.dispatchId));
  });
});
