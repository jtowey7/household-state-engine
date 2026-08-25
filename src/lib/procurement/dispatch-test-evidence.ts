import { basketApprovalFingerprint } from "./approval";
import {
  SUBMIT_GROCERY_ORDER_POLICY_ID,
  SUBMIT_GROCERY_ORDER_POLICY_VERSION,
  type DispatchEvidence,
} from "./dispatch";
import type { CandidateBasket } from "./types";

export function dispatchEvidence(
  basket: CandidateBasket,
  recordedAt = "2026-08-17T11:59:00.000Z",
): DispatchEvidence {
  const recorded = new Date(recordedAt);
  const startsAt = new Date(recorded.getTime() + 30 * 60 * 1000).toISOString();
  const endsAt = new Date(recorded.getTime() + 90 * 60 * 1000).toISOString();

  return {
    policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
    policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
    basketFingerprint: basketApprovalFingerprint(basket),
    deliverySlot: {
      slotId: "SLOT-001",
      retailer: "synthetic-grocer",
      startsAt,
      endsAt,
      recordedAt,
    },
    substitutions: {
      decisionId: "SUB-001",
      outcome: "NONE",
      recordedAt,
    },
    spendPolicy: {
      decisionId: "SPEND-001",
      totalCost: basket.totalCost,
      outcome: "WITHIN_POLICY",
      recordedAt,
    },
  };
}
