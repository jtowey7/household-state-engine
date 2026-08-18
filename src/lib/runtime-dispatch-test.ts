import { approveBasket, createBasketApproval } from "./procurement/approval";
import { createDispatchIntent } from "./procurement/dispatch";
import { createTestDispatchAdapter } from "./procurement/dispatch-adapter";
import { aggregateCandidateBasket, shadowCatalogue } from "./procurement";
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

function approvedState() {
  const basket = approvedBasket();
  const approval = approveBasket(
    createBasketApproval(basket),
    basket,
    "TEST-operator",
    "2026-08-17T22:01:00.000Z",
  );
  const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z");
  return { basket, approval, intent };
}

export async function runDispatchAdapterRuntimeProof() {
  const { basket, approval, intent } = approvedState();
  const adapter = createTestDispatchAdapter({
    acceptedAt: "2026-08-17T22:03:00.000Z",
    now: "2026-08-17T22:03:00.000Z",
  });

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
    const forgedApproval = {
      ...futureApproval.approval,
      approvedAt: "2026-08-17T22:05:00.000Z",
    };
    const futureApprovalAdapter = createTestDispatchAdapter({
      acceptedAt: "2026-08-17T22:06:00.000Z",
      now: "2026-08-17T22:06:00.000Z",
    });
    await futureApprovalAdapter.dispatch(futureApproval.intent, forgedApproval, futureApproval.basket);
  } catch (error) {
    futureApprovalRejected =
      error instanceof Error &&
      (error.message.includes("APPROVAL_ID_MISMATCH") || error.message.includes("APPROVAL_TIMESTAMP"));
  }

  const assertions = {
    approvedBasket: basket.readyForApproval === true,
    approvalGranted: approval.status === "APPROVED",
    intentReady: intent.status === "READY" && intent.requiresExternalDispatch === true,
    deterministicDispatchId:
      intent.dispatchId === createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z").dispatchId,
    accepted: first.status === "ACCEPTED",
    idempotentRepeat: second.dispatchId === first.dispatchId && second.externalOrderId === first.externalOrderId,
    parallelInvocationConvergence,
    changedBasketRejected,
    forgedIntentRejected,
    conflictingReuseRejected,
    expiredRejected,
    futureReceiptRejected,
    futureApprovalRejected,
    testOnlyReceipt: first.externalOrderId.startsWith("TEST-"),
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    mode: "TEST_ONLY",
    phase: "ORDER_DISPATCH",
    assertions,
    boundaryEvidence: {
      householdMutation: "NOT_EXECUTED",
      retailerIo: "NOT_EXECUTED",
      concurrencyModel: "SINGLE_PROCESS_IN_MEMORY",
      externalConcurrencyIdempotency: "NOT_EXECUTED",
      note: "Promise.all exercises parallel invocation against the in-memory TEST adapter, but the adapter has no asynchronous persistence/retailer boundary. This is convergence evidence, not proof of concurrent external-dispatch idempotency.",
    },
    dispatch: {
      dispatchId: first.dispatchId,
      status: first.status,
      externalOrderId: first.externalOrderId,
    },
  };
}
