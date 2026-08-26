import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";
import { basketApprovalFingerprint, validateBasketApproval, type BasketApproval } from "./approval";

export const DISPATCH_INTENT_TTL_MS = 15 * 60 * 1000;
export const EVIDENCE_MAX_AGE_MS = DISPATCH_INTENT_TTL_MS;
export const SUBMIT_GROCERY_ORDER_POLICY_ID = "submit-grocery-order:v1";
export const SUBMIT_GROCERY_ORDER_POLICY_VERSION = 1;

export type DeliverySlotEvidence = {
  slotId: string;
  retailer: string;
  startsAt: string;
  endsAt: string;
  recordedAt: string;
};

export type SubstitutionEvidence = {
  decisionId: string;
  outcome: "NONE" | "ACCEPTED" | "DECLINED";
  recordedAt: string;
};

export type SpendPolicyEvidence = {
  decisionId: string;
  totalCost: number;
  outcome: "WITHIN_POLICY" | "SEPARATE_APPROVAL_REQUIRED";
  recordedAt: string;
};

export type DispatchEvidence = {
  policyIdentity: typeof SUBMIT_GROCERY_ORDER_POLICY_ID;
  policyVersion: typeof SUBMIT_GROCERY_ORDER_POLICY_VERSION;
  basketFingerprint: string;
  deliverySlot: DeliverySlotEvidence;
  substitutions: SubstitutionEvidence;
  spendPolicy: SpendPolicyEvidence;
};

export type DispatchIntent = {
  dispatchId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  policyIdentity: typeof SUBMIT_GROCERY_ORDER_POLICY_ID;
  policyVersion: typeof SUBMIT_GROCERY_ORDER_POLICY_VERSION;
  retailer: string | null;
  createdAt: string;
  expiresAt: string;
  status: "READY";
  requiresExternalDispatch: true;
  evidence: DispatchEvidence;
};

export function validateDispatchEvidence(
  evidence: DispatchEvidence,
  basket: CandidateBasket,
  asOf?: string,
  approvedAt?: string,
): void {
  const asOfTime = asOf === undefined ? undefined : Date.parse(asOf);
  if (asOf !== undefined && (asOf.trim() === "" || Number.isNaN(asOfTime))) {
    throw new Error("Cannot create dispatch intent: EVIDENCE_AS_OF_INVALID");
  }

  if (evidence.policyIdentity !== SUBMIT_GROCERY_ORDER_POLICY_ID) {
    throw new Error("Cannot create dispatch intent: POLICY_ID_MISMATCH");
  }
  if (evidence.policyVersion !== SUBMIT_GROCERY_ORDER_POLICY_VERSION) {
    throw new Error("Cannot create dispatch intent: POLICY_VERSION_MISMATCH");
  }

  const approvalTime = approvedAt === undefined ? undefined : Date.parse(approvedAt);
  if (
    approvedAt !== undefined &&
    (approvedAt.trim() === "" || Number.isNaN(approvalTime))
  ) {
    throw new Error("Cannot create dispatch intent: APPROVAL_TIMESTAMP_INVALID");
  }

  if (evidence.basketFingerprint !== basketApprovalFingerprint(basket)) {
    throw new Error("Cannot create dispatch intent: EVIDENCE_BASKET_CHANGED");
  }

  if (!evidence.deliverySlot.slotId.trim() || !evidence.deliverySlot.retailer.trim()) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_REQUIRED");
  }
  const startsAt = Date.parse(evidence.deliverySlot.startsAt);
  const endsAt = Date.parse(evidence.deliverySlot.endsAt);
  const recordedAt = Date.parse(evidence.deliverySlot.recordedAt);
  if ([startsAt, endsAt, recordedAt].some(Number.isNaN) || endsAt <= startsAt) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_INVALID");
  }
  if (asOfTime !== undefined && recordedAt > asOfTime) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_FUTURE");
  }
  if (asOfTime !== undefined && recordedAt < asOfTime - EVIDENCE_MAX_AGE_MS) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_STALE");
  }
  if (approvalTime !== undefined && recordedAt < approvalTime) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_STALE");
  }
  if (asOfTime !== undefined && endsAt <= asOfTime) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_EVIDENCE_EXPIRED");
  }
  if (evidence.deliverySlot.retailer !== basket.retailer) {
    throw new Error("Cannot create dispatch intent: DELIVERY_SLOT_RETAILER_MISMATCH");
  }

  const substitutionRecordedAt = Date.parse(evidence.substitutions.recordedAt);
  if (!evidence.substitutions.decisionId.trim()) {
    throw new Error("Cannot create dispatch intent: SUBSTITUTION_EVIDENCE_REQUIRED");
  }
  if (Number.isNaN(substitutionRecordedAt)) {
    throw new Error("Cannot create dispatch intent: SUBSTITUTION_EVIDENCE_INVALID");
  }
  if (asOfTime !== undefined && substitutionRecordedAt > asOfTime) {
    throw new Error("Cannot create dispatch intent: SUBSTITUTION_EVIDENCE_FUTURE");
  }
  if (asOfTime !== undefined && substitutionRecordedAt < asOfTime - EVIDENCE_MAX_AGE_MS) {
    throw new Error("Cannot create dispatch intent: SUBSTITUTION_EVIDENCE_STALE");
  }
  if (approvalTime !== undefined && substitutionRecordedAt < approvalTime) {
    throw new Error("Cannot create dispatch intent: SUBSTITUTION_EVIDENCE_STALE");
  }

  const spendRecordedAt = Date.parse(evidence.spendPolicy.recordedAt);
  if (!evidence.spendPolicy.decisionId.trim()) {
    throw new Error("Cannot create dispatch intent: SPEND_POLICY_EVIDENCE_REQUIRED");
  }
  if (!Number.isFinite(evidence.spendPolicy.totalCost) || evidence.spendPolicy.totalCost !== basket.totalCost) {
    throw new Error("Cannot create dispatch intent: SPEND_TOTAL_MISMATCH");
  }
  if (evidence.spendPolicy.outcome !== "WITHIN_POLICY") {
    throw new Error("Cannot create dispatch intent: SPEND_APPROVAL_REQUIRED");
  }
  if (Number.isNaN(spendRecordedAt)) {
    throw new Error("Cannot create dispatch intent: SPEND_POLICY_EVIDENCE_INVALID");
  }
  if (asOfTime !== undefined && spendRecordedAt > asOfTime) {
    throw new Error("Cannot create dispatch intent: SPEND_POLICY_EVIDENCE_FUTURE");
  }
  if (asOfTime !== undefined && spendRecordedAt < asOfTime - EVIDENCE_MAX_AGE_MS) {
    throw new Error("Cannot create dispatch intent: SPEND_POLICY_EVIDENCE_STALE");
  }
  if (approvalTime !== undefined && spendRecordedAt < approvalTime) {
    throw new Error("Cannot create dispatch intent: SPEND_POLICY_EVIDENCE_STALE");
  }
}

export function createDispatchIntent(
  approval: BasketApproval,
  basket: CandidateBasket,
  createdAt: string,
  evidence: DispatchEvidence,
): DispatchIntent {
  if (!createdAt.trim() || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("Cannot create dispatch intent: DISPATCH_TIMESTAMP_INVALID");
  }

  if (!basket.retailer) {
    throw new Error("Cannot create dispatch intent: RETAILER_REQUIRED");
  }

  const validation = validateBasketApproval(approval, basket, createdAt);
  if (!validation.valid) {
    throw new Error(`Cannot create dispatch intent: ${validation.reason}`);
  }

  validateDispatchEvidence(evidence, basket, createdAt, approval.approvedAt ?? undefined);

  const expiresAt = new Date(Date.parse(createdAt) + DISPATCH_INTENT_TTL_MS).toISOString();
  const dispatchId = hashOf({
    basketId: basket.basketId,
    basketVersion: approval.basketVersion,
    basketFingerprint: approval.basketFingerprint,
    retailer: basket.retailer,
    policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
    policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
    evidence,
  });

  return {
    dispatchId,
    basketId: basket.basketId,
    basketVersion: approval.basketVersion,
    basketFingerprint: approval.basketFingerprint,
    policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
    policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
    retailer: basket.retailer,
    createdAt,
    expiresAt,
    status: "READY",
    requiresExternalDispatch: true,
    evidence,
  };
}
