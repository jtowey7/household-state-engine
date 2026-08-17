import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";
import { validateBasketApproval, type BasketApproval } from "./approval";

export type DispatchIntent = {
  dispatchId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  retailer: string | null;
  createdAt: string;
  status: "READY";
  requiresExternalDispatch: true;
};

/**
 * Creates an immutable, non-dispatching order intent from an approved basket.
 * This is the Phase 7 boundary only: no retailer API, queue, or household
 * state is touched here. A real dispatch adapter must consume this intent
 * separately and must re-check the approval at execution time.
 */
export function createDispatchIntent(
  approval: BasketApproval,
  basket: CandidateBasket,
  createdAt: string,
): DispatchIntent {
  if (!createdAt.trim() || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("Cannot create dispatch intent: DISPATCH_TIMESTAMP_INVALID");
  }

  const validation = validateBasketApproval(approval, basket);
  if (!validation.valid) {
    throw new Error(`Cannot create dispatch intent: ${validation.reason}`);
  }

  if (!basket.retailer) {
    throw new Error("Cannot create dispatch intent: RETAILER_REQUIRED");
  }

  const dispatchId = hashOf({
    basketId: basket.basketId,
    basketVersion: approval.basketVersion,
    basketFingerprint: approval.basketFingerprint,
    retailer: basket.retailer,
  });

  return {
    dispatchId,
    basketId: basket.basketId,
    basketVersion: approval.basketVersion,
    basketFingerprint: approval.basketFingerprint,
    retailer: basket.retailer,
    createdAt,
    status: "READY",
    requiresExternalDispatch: true,
  };
}
