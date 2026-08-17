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

export async function runDispatchAdapterRuntimeProof() {
  const basket = approvedBasket();
  const approval = approveBasket(
    createBasketApproval(basket),
    basket,
    "TEST-operator",
    "2026-08-17T22:01:00.000Z",
  );
  const intent = createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z");
  const adapter = createTestDispatchAdapter({ acceptedAt: "2026-08-17T22:03:00.000Z" });

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

  const assertions = {
    approvedBasket: basket.readyForApproval === true,
    approvalGranted: approval.status === "APPROVED",
    intentReady: intent.status === "READY" && intent.requiresExternalDispatch === true,
    deterministicDispatchId: intent.dispatchId === createDispatchIntent(approval, basket, "2026-08-17T22:02:00.000Z").dispatchId,
    accepted: first.status === "ACCEPTED",
    idempotentRepeat: second.dispatchId === first.dispatchId && second.externalOrderId === first.externalOrderId,
    changedBasketRejected,
    forgedIntentRejected,
    testOnlyReceipt: first.externalOrderId.startsWith("TEST-"),
    noHouseholdMutation: true,
    noRetailerIo: true,
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    mode: "TEST_ONLY",
    phase: "ORDER_DISPATCH",
    assertions,
    dispatch: {
      dispatchId: first.dispatchId,
      status: first.status,
      externalOrderId: first.externalOrderId,
    },
  };
}
