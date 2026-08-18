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

describe("TEST dispatch adapter: concurrent idempotency", () => {
  it("returns one identical receipt for concurrent reuse of the same dispatch intent", async () => {
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
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T12:02:00.000Z" });

    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => adapter.dispatch(intent, approval, basket)),
    );

    expect(new Set(receipts.map((receipt) => receipt.dispatchId)).size).toBe(1);
    expect(new Set(receipts.map((receipt) => receipt.externalOrderId)).size).toBe(1);
    expect(new Set(receipts.map((receipt) => receipt.acceptedAt)).size).toBe(1);
    expect(receipts.every((receipt) => receipt.status === "ACCEPTED")).toBe(true);
  });
});
