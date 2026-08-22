import { describe, expect, it } from "vitest";

import { approveBasket, createBasketApproval } from "./approval";
import { createDispatchIntent, type DispatchEvidence } from "./dispatch";
import { createTestDispatchAdapter, type DispatchReceiptStore } from "./dispatch-adapter";
import { aggregateCandidateBasket, shadowCatalogue } from ".";
import { hashOf } from "../state-engine/hash";
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

function evidence(totalCost: number): DispatchEvidence {
  return {
    deliverySlot: {
      slotId: "SLOT-001",
      retailer: "synthetic-grocer",
      startsAt: "2026-08-17T18:00:00.000Z",
      endsAt: "2026-08-17T19:00:00.000Z",
      recordedAt: "2026-08-17T11:59:00.000Z",
    },
    substitutions: {
      decisionId: "SUB-001",
      outcome: "NONE",
      recordedAt: "2026-08-17T11:59:00.000Z",
    },
    spendPolicy: {
      decisionId: "SPEND-001",
      totalCost,
      outcome: "WITHIN_POLICY",
      recordedAt: "2026-08-17T11:59:00.000Z",
    },
  };
}

function approvedIntent(retailer = "synthetic-grocer") {
  const basket = approvedBasket(retailer);
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
    evidence(basket.totalCost),
  );
  return { basket, approval, intent };
}

describe("TEST dispatch adapter", () => {
  it("re-checks approval and evidence at execution and returns an idempotent receipt", async () => {
    const { basket, approval, intent } = approvedIntent();
    const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T12:02:00.000Z" });

    const first = await adapter.dispatch(intent, approval, basket);
    const second = await adapter.dispatch(intent, approval, basket);

    expect(first).toEqual(second);
    expect(first.dispatchId).toBe(intent.dispatchId);
    expect(first.status).toBe("ACCEPTED");
    expect(first.externalOrderId).toBe(`TEST-${intent.dispatchId}`);
  });

  it("preserves dispatch identity across adapter recreation when the receipt store is retained", async () => {
    const { basket, approval, intent } = approvedIntent();
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

  it("serializes concurrent same-dispatch-id execution and persists one receipt", async () => {
    const { basket, approval, intent } = approvedIntent();
    const records = new Map();
    let writes = 0;
    let releaseGet: (() => void) | undefined;
    let getStartedResolve: (() => void) | undefined;
    const getStarted = new Promise<void>((resolve) => {
      getStartedResolve = resolve;
    });
    const firstGetRelease = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let firstGet = true;
    const receiptStore: DispatchReceiptStore = {
      async get(dispatchId) {
        if (firstGet) {
          firstGet = false;
          getStartedResolve?.();
          await firstGetRelease;
        }
        return records.get(dispatchId);
      },
      async set(dispatchId, record) {
        writes += 1;
        records.set(dispatchId, record);
      },
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
      receiptStore,
    });

    const first = adapter.dispatch(intent, approval, basket);
    await getStarted;
    const second = adapter.dispatch(intent, approval, basket);
    releaseGet?.();

    const [firstReceipt, secondReceipt] = await Promise.all([first, second]);
    expect(firstReceipt).toEqual(secondReceipt);
    expect(writes).toBe(1);
    expect(records.size).toBe(1);
  });

  it("blocks execution when the approved basket has changed", async () => {
    const { basket, approval, intent } = approvedIntent();
    const changedBasket = { ...basket, totalCost: basket.totalCost + 1 };
    const adapter = createTestDispatchAdapter({ now: "2026-08-17T12:02:00.000Z" });

    await expect(adapter.dispatch(intent, approval, changedBasket)).rejects.toThrow("BASKET_CHANGED");
  });

  it("rejects a stale intent after its freshness window", async () => {
    const { basket, approval, intent } = approvedIntent();
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:20:00.000Z",
      now: "2026-08-17T12:20:00.000Z",
    });

    await expect(adapter.dispatch(intent, approval, basket)).rejects.toThrow("DISPATCH_INTENT_EXPIRED");
  });

  it("rejects forged dispatch identity", async () => {
    const { basket, approval, intent } = approvedIntent();
    const forged = { ...intent, dispatchId: "forged-dispatch-id" };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(forged, approval, basket)).rejects.toThrow("DISPATCH_ID_INVALID");
  });

  it("rejects evidence mutation after intent creation", async () => {
    const { basket, approval, intent } = approvedIntent();
    const mutated = {
      ...intent,
      evidence: {
        ...intent.evidence,
        spendPolicy: {
          ...intent.evidence.spendPolicy,
          totalCost: intent.evidence.spendPolicy.totalCost + 1,
        },
      },
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(mutated, approval, basket)).rejects.toThrow("SPEND_TOTAL_MISMATCH");
  });

  it("rejects future-dated evidence at execution", async () => {
    const { basket, approval, intent } = approvedIntent();
    const future = "2026-08-17T12:03:00.000Z";
    const forged = {
      ...intent,
      evidence: {
        ...intent.evidence,
        spendPolicy: {
          ...intent.evidence.spendPolicy,
          recordedAt: future,
        },
      },
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(forged, approval, basket)).rejects.toThrow("SPEND_POLICY_EVIDENCE_FUTURE");
  });

  it("rejects an execution-time delivery slot that has already expired", async () => {
    const { basket, approval, intent } = approvedIntent();
    const expiredEvidence = {
      ...intent.evidence,
      deliverySlot: {
        ...intent.evidence.deliverySlot,
        startsAt: "2026-08-17T10:00:00.000Z",
        endsAt: "2026-08-17T11:00:00.000Z",
      },
    };
    const forged = {
      ...intent,
      evidence: expiredEvidence,
      dispatchId: hashOf({
        basketId: basket.basketId,
        basketVersion: approval.basketVersion,
        basketFingerprint: approval.basketFingerprint,
        retailer: basket.retailer,
        evidence: expiredEvidence,
      }),
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(forged, approval, basket)).rejects.toThrow("DELIVERY_SLOT_EVIDENCE_EXPIRED");
  });

  it("rejects missing execution evidence", async () => {
    const { basket, approval, intent } = approvedIntent();
    const invalid = {
      ...intent,
      evidence: {
        ...intent.evidence,
        deliverySlot: { ...intent.evidence.deliverySlot, slotId: "" },
      },
    };
    const adapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T12:02:00.000Z",
      now: "2026-08-17T12:02:00.000Z",
    });

    await expect(adapter.dispatch(invalid, approval, basket)).rejects.toThrow("DELIVERY_SLOT_EVIDENCE_REQUIRED");
  });
});
