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

type DispatchRecord = {
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  retailer: string;
  receipt: DispatchReceipt;
};

/**
 * TEST-only adapter. It exercises the execution contract without retailer I/O.
 * The same intent is idempotent; a conflicting reuse is rejected.
 */
export function createTestDispatchAdapter(options: TestDispatchAdapterOptions = {}): DispatchAdapter {
  const acceptedAt = options.acceptedAt ?? "2026-08-17T00:00:00.000Z";
  const receipts = new Map<string, DispatchRecord>();

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
        const samePayload =
          existing.basketId === intent.basketId &&
          existing.basketVersion === intent.basketVersion &&
          existing.basketFingerprint === intent.basketFingerprint &&
          existing.retailer === intent.retailer;
        if (!samePayload) {
          throw new Error("Cannot dispatch intent: DISPATCH_ID_CONFLICT");
        }
        return existing.receipt;
      }

      const receipt: DispatchReceipt = {
        dispatchId: intent.dispatchId,
        retailer: intent.retailer,
        externalOrderId: `TEST-${intent.dispatchId}`,
        acceptedAt,
        status: "ACCEPTED",
      };
      receipts.set(intent.dispatchId, {
        basketId: intent.basketId,
        basketVersion: intent.basketVersion,
        basketFingerprint: intent.basketFingerprint,
        retailer: intent.retailer,
        receipt,
      });
      return receipt;
    },
  };
}
