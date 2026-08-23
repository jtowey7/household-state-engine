import { approveBasket, createBasketApproval } from "./procurement/approval";
import { createDispatchIntent, type DispatchEvidence } from "./procurement/dispatch";
import { createTestDispatchAdapter } from "./procurement/dispatch-adapter";
import { createD1DispatchReceiptStore, type D1DatabaseLike } from "./procurement/d1-dispatch-receipt-store";
import { aggregateCandidateBasket, shadowCatalogue } from "./procurement";
import { hashOf } from "./state-engine/hash";
import type { QuantityRunPlan } from "./quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "RUNTIME-DISPATCH-R1",
  snapshotId: "RUNTIME-DISPATCH-S1",
  replayTimestamp: "2026-08-17T22:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "RUNTIME-DISPATCH-P1",
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
      sourceEventIds: ["RUNTIME-DISPATCH-EVT-1"],
      packSize: 500,
      packCount: 3,
      packRoundedQuantity: 1500,
    },
  ],
};

function approvedBasket() {
  return aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" });
}

function dispatchEvidence(basket: ReturnType<typeof approvedBasket>): DispatchEvidence {
  return {
    deliverySlot: {
      slotId: "RUNTIME-DISPATCH-SLOT-1",
      retailer: basket.retailer,
      startsAt: "2026-08-17T22:30:00.000Z",
      endsAt: "2026-08-17T23:30:00.000Z",
      recordedAt: "2026-08-17T22:01:30.000Z",
    },
    substitutions: {
      decisionId: "RUNTIME-DISPATCH-SUB-1",
      outcome: "NONE",
      recordedAt: "2026-08-17T22:01:30.000Z",
    },
    spendPolicy: {
      decisionId: "RUNTIME-DISPATCH-SPEND-1",
      totalCost: basket.totalCost,
      outcome: "WITHIN_POLICY",
      recordedAt: "2026-08-17T22:01:30.000Z",
    },
  };
}

function approvedState() {
  const basket = approvedBasket();
  const approval = approveBasket(
    createBasketApproval(basket),
    basket,
    "TEST-operator",
    "2026-08-17T22:01:00.000Z",
  );
  const evidence = dispatchEvidence(basket);
  const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z", evidence);
  return { basket, approval, intent };
}

async function resolveRuntimeReceiptStore() {
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    const db = cloudflareWorkers.env?.FOODOS_RUNTIME_TEST as D1DatabaseLike | undefined;
    return db ? createD1DispatchReceiptStore(db) : undefined;
  } catch {
    return undefined;
  }
}

export async function runDispatchAdapterRuntimeProof() {
  const { basket, approval, intent } = approvedState();
  const receiptStore = await resolveRuntimeReceiptStore();
  const adapterOptions = {
    acceptedAt: "2026-08-17T22:03:00.000Z",
    now: "2026-08-17T22:03:00.000Z",
    ...(receiptStore ? { receiptStore } : {}),
  };
  const adapter = createTestDispatchAdapter(adapterOptions);

  const first = await adapter.dispatch(intent, approval, basket);
  const second = await adapter.dispatch(intent, approval, basket);

  let changedBasketRejected = false;
  try {
    await adapter.dispatch(intent, approval, { ...basket, totalCost: basket.totalCost + 1 });
  } catch (error) {
    changedBasketRejected = error instanceof Error && error.message.includes("BASKET_CHANGED");
  }

  let forgedIntentRejected = false;
  try {
    await adapter.dispatch({ ...intent, dispatchId: "forged-runtime-dispatch-id" }, approval, basket);
  } catch (error) {
    forgedIntentRejected = error instanceof Error && error.message.includes("DISPATCH_ID_INVALID");
  }

  const parallelReceipts = await Promise.all(
    Array.from({ length: 8 }, () => adapter.dispatch(intent, approval, basket)),
  );
  const parallelInvocationConvergence = parallelReceipts.every(
    (receipt) => receipt.externalOrderId === first.externalOrderId && receipt.dispatchId === first.dispatchId,
  );

  let d1ConcurrentAdapterConvergence = false;
  if (receiptStore) {
    const concurrentAdapters = Array.from({ length: 8 }, () => createTestDispatchAdapter(adapterOptions));
    const concurrentReceipts = await Promise.all(
      concurrentAdapters.map((concurrentAdapter) => concurrentAdapter.dispatch(intent, approval, basket)),
    );
    d1ConcurrentAdapterConvergence = concurrentReceipts.every(
      (receipt) => receipt.externalOrderId === first.externalOrderId && receipt.dispatchId === first.dispatchId,
    );
  }

  let conflictingReuseRejected = false;
  try {
    await adapter.dispatch(
      {
        ...intent,
        basketFingerprint: "conflicting-runtime-fingerprint",
      },
      approval,
      basket,
    );
  } catch (error) {
    conflictingReuseRejected = error instanceof Error && error.message.includes("BASKET_CHANGED");
  }

  let expiredRejected = false;
  try {
    const expired = approvedState();
    const expiredAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T22:17:00.000Z",
      now: "2026-08-17T22:17:00.000Z",
    });
    await expiredAdapter.dispatch(expired.intent, expired.approval, expired.basket);
  } catch (error) {
    expiredRejected = error instanceof Error && error.message.includes("DISPATCH_INTENT_EXPIRED");
  }

  let futureReceiptRejected = false;
  try {
    const futureReceipt = approvedState();
    const futureReceiptAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T22:04:00.000Z",
      now: "2026-08-17T22:03:00.000Z",
    });
    await futureReceiptAdapter.dispatch(futureReceipt.intent, futureReceipt.approval, futureReceipt.basket);
  } catch (error) {
    futureReceiptRejected = error instanceof Error && error.message.includes("ACCEPTED_TIMESTAMP_INVALID");
  }

  let futureApprovalRejected = false;
  try {
    const futureApproval = approvedState();
    const futureApprovedAt = "2026-08-17T22:05:00.000Z";
    const forgedApproval = {
      ...futureApproval.approval,
      approvedAt: futureApprovedAt,
      approvalId: hashOf({
        basketId: futureApproval.approval.basketId,
        basketVersion: futureApproval.approval.basketVersion,
        fingerprint: futureApproval.approval.basketFingerprint,
        judgeId: futureApproval.approval.judgeId,
        approvedAt: futureApprovedAt,
        approvedBy: futureApproval.approval.approvedBy,
      }),
    };
    const futureApprovalAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T22:03:00.000Z",
      now: "2026-08-17T22:04:00.000Z",
    });
    await futureApprovalAdapter.dispatch(futureApproval.intent, forgedApproval, futureApproval.basket);
  } catch (error) {
    futureApprovalRejected = error instanceof Error && error.message.includes("APPROVAL_TIMESTAMP_FUTURE");
  }

  let adapterRecreationPersistence = false;
  if (receiptStore) {
    const recreatedAdapter = createTestDispatchAdapter(adapterOptions);
    const recreated = await recreatedAdapter.dispatch(intent, approval, basket);
    adapterRecreationPersistence =
      recreated.dispatchId === first.dispatchId && recreated.externalOrderId === first.externalOrderId;
  }

  const assertions = {
    approvedBasket: basket.readyForApproval === true,
    approvalGranted: approval.status === "APPROVED",
    intentReady: intent.status === "READY" && intent.requiresExternalDispatch === true,
    deterministicDispatchId:
      intent.dispatchId === createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z", dispatchEvidence(basket)).dispatchId,
    accepted: first.status === "ACCEPTED",
    idempotentRepeat: second.dispatchId === first.dispatchId && second.externalOrderId === first.externalOrderId,
    parallelInvocationConvergence,
    ...(receiptStore ? { d1ConcurrentAdapterConvergence } : {}),
    changedBasketRejected,
    forgedIntentRejected,
    conflictingReuseRejected,
    expiredRejected,
    futureReceiptRejected,
    futureApprovalRejected,
    testOnlyReceipt: first.externalOrderId.startsWith("TEST-"),
    ...(receiptStore ? { adapterRecreationPersistence } : {}),
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    mode: "TEST_ONLY",
    phase: "ORDER_DISPATCH",
    assertions,
    boundaryEvidence: {
      householdMutation: "NOT_EXECUTED",
      retailerIo: "NOT_EXECUTED",
      concurrencyModel: receiptStore ? "D1_RUNTIME_TEST" : "SINGLE_PROCESS_IN_MEMORY",
      externalConcurrencyIdempotency: "NOT_EXECUTED",
      receiptPersistence: receiptStore ? "D1_RUNTIME_TEST" : "IN_MEMORY_FALLBACK",
      note: receiptStore
        ? "The deployed TEST proof uses the owned runtime D1 receipt store, recreates the adapter against the same persistent store, and exercises eight fresh adapter instances concurrently. This proves D1-backed TEST persistence/idempotency and concurrent adapter convergence, not external retailer concurrency."
        : "The runtime D1 binding was unavailable, so the proof used the in-memory TEST adapter. This is not sufficient to claim D1 persistence acceptance.",
    },
    dispatch: {
      dispatchId: first.dispatchId,
      status: first.status,
      externalOrderId: first.externalOrderId,
    },
  };
}
