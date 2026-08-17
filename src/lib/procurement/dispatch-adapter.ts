import { validateBasketApproval, type BasketApproval } from "./approval";
import type { CandidateBasket } from "./types";
import type { DispatchIntent } from "./dispatch";

export type DispatchReceipt = {
  dispatchId: string;
  retailer: string;
  externalOrderId: string;
  acceptedAt: string;
  status: "ACCEPTED";
};

export interface DispatchAdapter {
  /**
   * Execution boundary: implementations must re-check approval against the
   * current basket before any external mutation. The interface deliberately
   * exposes no household-state write capability.
   */
  dispatch(
    intent: DispatchIntent,
    approval: BasketApproval,
    currentBasket: CandidateBasket,
  ): Promise<DispatchReceipt>;
}

type TestDispatchAdapterOptions = {
  acceptedAt?: string;
};

/**
 * TEST-only adapter. It exercises the execution contract without retailer I/O.
 * The same intent is idempotent; a conflicting reuse is rejected.
 */
export function createTestDispatchAdapter(options: TestDispatchAdapterOptions = {}): DispatchAdapter {
  const acceptedAt = options.acceptedAt ?? "2026-08-17T00:00:00.000Z";
  const receipts = new Map<string, DispatchReceipt>();

  return {
    async dispatch(intent, approval, currentBasket) {
      const validation = validateBasketApproval(approval, currentBasket);
      if (!validation.valid) {
        throw new Error(`Cannot dispatch intent: ${validation.reason}`);
      }
      if (intent.basketId !== currentBasket.basketId) {
        throw new Error("Cannot dispatch intent: BASKET_CHANGED");
      }
      if (intent.basketVersion !== approval.basketVersion) {
        throw new Error("Cannot dispatch intent: VERSION_MISMATCH");
      }
      if (intent.basketFingerprint !== approval.basketFingerprint) {
        throw new Error("Cannot dispatch intent: BASKET_CHANGED");
      }
      if (intent.retailer !== currentBasket.retailer || !intent.retailer) {
        throw new Error("Cannot dispatch intent: RETAILER_MISMATCH");
      }

      const existing = receipts.get(intent.dispatchId);
      if (existing) {
        if (existing.retailer !== intent.retailer) {
          throw new Error("Cannot dispatch intent: DISPATCH_ID_CONFLICT");
        }
        return existing;
      }

      const receipt: DispatchReceipt = {
        dispatchId: intent.dispatchId,
        retailer: intent.retailer,
        externalOrderId: `TEST-${intent.dispatchId}`,
        acceptedAt,
        status: "ACCEPTED",
      };
      receipts.set(intent.dispatchId, receipt);
      return receipt;
    },
  };
}
