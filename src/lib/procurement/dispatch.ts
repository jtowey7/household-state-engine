import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";
import { validateBasketApproval, type BasketApproval } from "./approval";

const DISPATCH_INTENT_TTL_MS = 15 * 60 * 1000;

export type DispatchIntent = {
  dispatchId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  retailer: string | null;
  createdAt: string;
  expiresAt: string;
  status: "READY";
  requiresExternalDispatch: true;
};

/**
 * Creates an immutable, time-bounded, non-dispatching order intent from an
 * approved basket. This is the Phase 7 boundary only: no retailer API, queue,
 * or household state is touched here. A real dispatch adapter must consume
 * this intent separately and must re-check the approval and freshness at
 * execution time.
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

  const expiresAt = new Date(Date.parse(createdAt) + DISPATCH_INTENT_TTL_MS).toISOString();
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
    expiresAt,
    status: "READY",
    requiresExternalDispatch: true,
  };
}
