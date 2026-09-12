import { hashOf } from "../state-engine/hash";
import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";

export const SUBMIT_GROCERY_ORDER_POLICY_ID = "submit-grocery-order:v1";
export const SUBMIT_GROCERY_ORDER_POLICY_VERSION = 1;

export type BasketApprovalStatus = "PENDING" | "APPROVED" | "INVALIDATED";

export interface BasketApproval {
  approvalId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  judgeId: string;
  policyIdentity: typeof SUBMIT_GROCERY_ORDER_POLICY_ID;
  policyVersion: typeof SUBMIT_GROCERY_ORDER_POLICY_VERSION;
  status: BasketApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
}

export type ApprovalValidation =
  | { valid: true }
  | {
      valid: false;
      reason:
        | "NOT_APPROVED"
        | "BASKET_CHANGED"
        | "VERSION_MISMATCH"
        | "BASKET_NOT_APPROVABLE"
        | "APPROVAL_PROVENANCE_INVALID"
        | "APPROVAL_TIMESTAMP_INVALID"
        | "APPROVAL_TIMESTAMP_FUTURE"
        | "JUDGE_RESULT_CHANGED"
        | "POLICY_ID_MISMATCH"
        | "POLICY_VERSION_MISMATCH";
    };

export function basketApprovalFingerprint(basket: CandidateBasket): string {
  return hashOf({
    basketId: basket.basketId,
    planId: basket.planId,
    snapshotId: basket.snapshotId,
    replayId: basket.replayId,
    replayTimestamp: basket.replayTimestamp,
    retailer: basket.retailer,
    lines: basket.lines.map((line) => ({
      itemKey: line.itemKey,
      sku: line.sku,
      productName: line.productName,
      productUrl: line.productUrl,
      retailer: line.retailer,
      requiredQuantity: line.requiredQuantity,
      unit: line.unit,
      packSize: line.packSize,
      packUnit: line.packUnit,
      packCount: line.packCount,
      orderedQuantity: line.orderedQuantity,
      lineCost: line.lineCost,
      requirementIds: [...line.requirementIds].sort(),
      sourceEventIds: [...line.sourceEventIds].sort(),
    })),
    exceptions: basket.exceptions.map((exception) => ({
      code: exception.code,
      itemKey: exception.itemKey,
      detail: exception.detail,
      fatal: exception.fatal,
    })),
    totalCost: basket.totalCost,
    coverage: basket.coverage,
    complete: basket.complete,
    readyForApproval: basket.readyForApproval,
    dispatched: basket.dispatched,
    requiresHumanApproval: basket.requiresHumanApproval,
  });
}

function basketApprovalId(
  approval: Pick<
    BasketApproval,
    | "basketId"
    | "basketVersion"
    | "basketFingerprint"
    | "judgeId"
    | "policyIdentity"
    | "policyVersion"
    | "approvedAt"
    | "approvedBy"
  >,
): string {
  return hashOf({
    basketId: approval.basketId,
    basketVersion: approval.basketVersion,
    fingerprint: approval.basketFingerprint,
    judgeId: approval.judgeId,
    policyIdentity: approval.policyIdentity,
    policyVersion: approval.policyVersion,
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
  });
}

export function createBasketApproval(basket: CandidateBasket, basketVersion = 1): BasketApproval {
  const fingerprint = basketApprovalFingerprint(basket);
  const judgeId = judgeCandidateBasket(basket).judgeId;
  const approval: BasketApproval = {
    approvalId: "",
    basketId: basket.basketId,
    basketVersion,
    basketFingerprint: fingerprint,
    judgeId,
    policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
    policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
    status: "PENDING" as const,
    approvedAt: null,
    approvedBy: null,
  };
  return { ...approval, approvalId: basketApprovalId(approval) };
}

function validateBasketForApproval(
  approval: BasketApproval,
  basket: CandidateBasket,
  now = new Date().toISOString(),
): ApprovalValidation {
  if (approval.policyIdentity !== SUBMIT_GROCERY_ORDER_POLICY_ID) {
    return { valid: false, reason: "POLICY_ID_MISMATCH" };
  }
  if (approval.policyVersion !== SUBMIT_GROCERY_ORDER_POLICY_VERSION) {
    return { valid: false, reason: "POLICY_VERSION_MISMATCH" };
  }
  if (approval.basketId !== basket.basketId) {
    return { valid: false, reason: "BASKET_CHANGED" };
  }
  if (!Number.isSafeInteger(approval.basketVersion) || approval.basketVersion < 1) {
    return { valid: false, reason: "VERSION_MISMATCH" };
  }
  if (approval.basketFingerprint !== basketApprovalFingerprint(basket)) {
    return { valid: false, reason: "BASKET_CHANGED" };
  }

  const judge = judgeCandidateBasket(basket);
  if (judge.verdict !== "PASS" || !judge.readyForApproval || !basket.readyForApproval || !basket.complete) {
    return { valid: false, reason: "BASKET_NOT_APPROVABLE" };
  }
  if (approval.judgeId !== judge.judgeId) {
    return { valid: false, reason: "JUDGE_RESULT_CHANGED" };
  }
  const canonicalApprovalId = basketApprovalId(approval);
  if (approval.approvalId !== canonicalApprovalId) {
    return { valid: false, reason: "APPROVAL_PROVENANCE_INVALID" };
  }
  if (approval.status === "APPROVED") {
    const approvedTime = approval.approvedAt ? Date.parse(approval.approvedAt) : Number.NaN;
    const nowTime = Date.parse(now);
    if (Number.isNaN(approvedTime) || Number.isNaN(nowTime)) {
      return { valid: false, reason: "APPROVAL_TIMESTAMP_INVALID" };
    }
    if (approvedTime > nowTime) {
      return { valid: false, reason: "APPROVAL_TIMESTAMP_FUTURE" };
    }
  }
  return { valid: true };
}

export function approveBasket(
  approval: BasketApproval,
  basket: CandidateBasket,
  actor: string,
  approvedAt: string,
  now = new Date().toISOString(),
): BasketApproval {
  if (approval.status !== "PENDING") {
    throw new Error(`Cannot approve basket: ${approval.status}`);
  }
  if (!actor.trim()) {
    throw new Error("Cannot approve basket: APPROVAL_ACTOR_REQUIRED");
  }
  const approvedTime = Date.parse(approvedAt);
  const nowTime = Date.parse(now);
  if (!approvedAt.trim() || Number.isNaN(approvedTime) || Number.isNaN(nowTime)) {
    throw new Error("Cannot approve basket: APPROVAL_TIMESTAMP_INVALID");
  }
  if (approvedTime > nowTime) {
    throw new Error("Cannot approve basket: APPROVAL_TIMESTAMP_FUTURE");
  }
  const validation = validateBasketForApproval(approval, basket, now);
  if (!validation.valid) {
    throw new Error(`Cannot approve basket: ${validation.reason}`);
  }
  const nextApproval = {
    ...approval,
    status: "APPROVED" as const,
    approvedAt,
    approvedBy: actor.trim(),
  };
  return { ...nextApproval, approvalId: basketApprovalId(nextApproval) };
}

export function validateBasketApproval(
  approval: BasketApproval,
  basket: CandidateBasket,
  now = new Date().toISOString(),
): ApprovalValidation {
  if (approval.status !== "APPROVED") return { valid: false, reason: "NOT_APPROVED" };
  if (
    !approval.approvedBy?.trim() ||
    !approval.approvedAt?.trim() ||
    Number.isNaN(Date.parse(approval.approvedAt))
  ) {
    return { valid: false, reason: "APPROVAL_PROVENANCE_INVALID" };
  }
  return validateBasketForApproval(approval, basket, now);
}

export function supersedeBasketApproval(
  previous: BasketApproval,
  nextBasket: CandidateBasket,
): BasketApproval {
  const nextFingerprint = basketApprovalFingerprint(nextBasket);
  if (previous.basketFingerprint === nextFingerprint && previous.basketId === nextBasket.basketId) {
    return previous;
  }
  const nextVersion = previous.basketVersion + 1;
  return {
    ...createBasketApproval(nextBasket, nextVersion),
    status: "PENDING",
  };
}
