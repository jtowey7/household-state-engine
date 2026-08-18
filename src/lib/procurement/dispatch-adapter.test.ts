import { describe, expect, it } from "vitest";

import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { createTestDispatchAdapter, type DispatchReceiptStore } from "./dispatch-adapter";
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

function approvedBasket(retailer = "synthetic-grocer") {
  return aggregateCandidateBasket(plan, {
    catalogue: shadowCatalogue,
    retailer,
  });
}

describe("TEST dispatch adapter", () => {
  it("re-checks approval at execution and returns an idempotent receipt", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T12:02:00.000Z" });

    const first = await adapter.dispatch(intent, approval, basket);
    const second = await adapter.dispatch(intent, approval, basket);

    expect(first).toEqual(second);
    expect(first.dispatchId).toBe(intent.dispatchId);
    expect(first.status).toBe("ACCEPTED");
    expect(first.externalOrderId).toBe(`TEST-${intent.dispatchId}`);
  });

  it("preserves dispatch identity across adapter recreation when the receipt store is retained", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const receiptStore: DispatchReceiptStore = new Map();
    const firstAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      receiptStore,
    });
    const secondAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      receiptStore,
    });

    const first = await firstAdapter.dispatch(intent, approval, basket);
    const afterRecreation = await secondAdapter.dispatch(intent, approval, basket);

    expect(afterRecreation).toEqual(first);
    expect(receiptStore.size).toBe(1);
  });

  it("blocks execution when the approved basket has changed", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const changedBasket = { ...basket, totalCost: basket.totalCost + 1 };
    const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z" });

    await expect(adapter.dispatch(intent, approval, changedBasket)).rejects.toThrow("BASKET_CHANGED");
  });

  it("rejects a stale intent after its freshness window", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:20:00.000Z",
      now: "2026-08-17T12:20:00.000Z",
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("DISPATCH_INTENT_EXPIRED");
  });

  it("rejects forged dispatch identity even when the basket fields match", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = {
      ...createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z"),
      dispatchId: "forged-dispatch-id",
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("DISPATCH_ID_INVALID");
  });

  it("rejects an intent that is not ready for external dispatch", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = {
      ...createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z"),
      status: "DRAFT" as const,
      requiresExternalDispatch: false as const,
    };
    const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z" });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("INTENT_NOT_READY");
  });

  it("rejects an intent with an invalid creation timestamp", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = {
      ...createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z"),
      createdAt: "not-a-timestamp",
    };
    const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z" });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("DISPATCH_TIMESTAMP_INVALID");
  });

  it("rejects an approval recorded after the dispatch intent was created", async () => {
    const basket = approvedBasket();
    const validApproval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(validApproval, basket, "2026-08-17T12:01:00.000Z");
    const laterApproval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:05:00.000Z",
    );
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:06:00.000Z",
      now: "2026-08-17T12:06:00.000Z",
    });

    await expect(adapter.dispatch(intent, laterApproval, basket)).rejects.toThrow("APPROVAL_TIMESTAMP_INVALID");
  });

  it("rejects execution before the dispatch intent was created", async () => {
    const basket = approvedBasket();
    const approval = approveBasket(
      createBasketApproval(basket),
      basket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const intent = createDispatchIntent(approval, basket, "2026-08-17T12:01:00.000Z");
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:00:30.000Z",
      now: "2026-08-17T12:00:30.000Z",
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("EXECUTION_BEFORE_INTENT");
  });

  it("rejects reuse of a dispatch ID for a different retailer payload", async () => {
    const firstBasket = approvedBasket();
    const firstApproval = approveBasket(
      createBasketApproval(firstBasket),
      firstBasket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const firstIntent = createDispatchIntent(firstApproval, firstBasket, "2026-08-17T12:01:00.000Z");

    const secondBasket = {
      ...firstBasket,
      basketId: "BASKET-OTHER-RETAILER",
      retailer: "other-retailer",
      lines: firstBasket.lines.map((line) => ({ ...line, retailer: "other-retailer" })),
    };
    const secondApproval = approveBasket(
      createBasketApproval(secondBasket),
      secondBasket,
      "James",
      "2026-08-17T12:03:00.000Z",
    );
    const conflictingIntent = {
      ...createDispatchIntent(secondApproval, secondBasket, "2026-08-17T12:04:00.000Z"),
      dispatchId: firstIntent.dispatchId,
    };

    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:05:00.000Z",
      now: "2026-08-17T12:05:00.000Z",
    });
    await adapter.dispatch(firstIntent, firstApproval, firstBasket);
    await expect(adapter.dispatch(conflictingIntent, secondApproval, secondBasket)).rejects.toThrow(
      "DISPATCH_ID_INVALID",
    );
  });

  it("rejects reuse of a dispatch ID for a different basket payload at the same retailer", async () => {
    const firstBasket = approvedBasket();
    const firstApproval = approveBasket(
      createBasketApproval(firstBasket),
      firstBasket,
      "James",
      "2026-08-17T12:00:00.000Z",
    );
    const firstIntent = createDispatchIntent(firstApproval, firstBasket, "2026-08-17T12:01:00.000Z");

    const changedBasket = { ...firstBasket, totalCost: firstBasket.totalCost + 1 };
    const changedApproval = approveBasket(
      createBasketApproval(changedBasket),
      changedBasket,
      "James",
      "2026-08-17T12:03:00.000Z",
    );
    const conflictingIntent = {
      ...createDispatchIntent(changedApproval, changedBasket, "2026-08-17T12:04:00.000Z"),
      dispatchId: firstIntent.dispatchId,
    };

    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:05:00.000Z",
      now: "2026-08-17T12:05:00.000Z",
    });
    await adapter.dispatch(firstIntent, firstApproval, firstBasket);
    await expect(adapter.dispatch(conflictingIntent, changedApproval, changedBasket)).rejects.toThrow(
      "DISPATCH_ID_INVALID",
    );
  });
});
