import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";

export type BasketApprovalStatus = "PENDING" | "APPROVED" | "INVALIDATED";

export interface BasketApproval {
  approvalId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
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
        | "BASKET_NOT_APPROVABLE";
    };

/**
 * Fingerprint only the material procurement state that an approval authorises.
 * Presentation metadata is deliberately excluded so cosmetic UI changes do
 * not invalidate an otherwise identical approved basket.
 */
export function basketApprovalFingerprint(basket: CandidateBasket): string {
  return hashOf({
    basketId: basket.basketId,
    planId: basket.planId,
    snapshotId: basket.snapshotId,
    retailer: basket.retailer,
    lines: basket.lines.map((line) => ({
      itemKey: line.itemKey,
      sku: line.sku,
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
  });
}

export function createBasketApproval(basket: CandidateBasket, basketVersion = 1): BasketApproval {
  const fingerprint = basketApprovalFingerprint(basket);
  return {
    approvalId: hashOf({ basketId: basket.basketId, basketVersion, fingerprint }),
    basketId: basket.basketId,
    basketVersion,
    basketFingerprint: fingerprint,
    status: "PENDING",
    approvedAt: null,
    approvedBy: null,
  };
}

/** Validate the basket itself before a human approval can be recorded. */
function validateBasketForApproval(
  approval: BasketApproval,
  basket: CandidateBasket,
): ApprovalValidation {
  if (!basket.readyForApproval || !basket.complete) {
    return { valid: false, reason: "BASKET_NOT_APPROVABLE" };
  }
  if (approval.basketId !== basket.basketId) {
    return { valid: false, reason: "BASKET_CHANGED" };
  }
  if (approval.basketVersion < 1) {
    return { valid: false, reason: "VERSION_MISMATCH" };
  }
  if (approval.basketFingerprint !== basketApprovalFingerprint(basket)) {
    return { valid: false, reason: "BASKET_CHANGED" };
  }
  return { valid: true };
}

/** Approval is an explicit human action and can only bind to a complete basket. */
export function approveBasket(
  approval: BasketApproval,
  basket: CandidateBasket,
  actor: string,
  approvedAt: string,
): BasketApproval {
  if (approval.status !== "PENDING") {
    throw new Error(`Cannot approve basket: ${approval.status}`);
  }
  if (!actor.trim()) {
    throw new Error("Cannot approve basket: APPROVAL_ACTOR_REQUIRED");
  }
  if (!approvedAt.trim() || Number.isNaN(Date.parse(approvedAt))) {
    throw new Error("Cannot approve basket: APPROVAL_TIMESTAMP_INVALID");
  }
  const validation = validateBasketForApproval(approval, basket);
  if (!validation.valid) {
    throw new Error(`Cannot approve basket: ${validation.reason}`);
  }
  return {
    ...approval,
    status: "APPROVED",
    approvedAt,
    approvedBy: actor.trim(),
  };
}

/**
 * Execution-time gate. An approval is never transferable to a materially
 * changed basket, even when the basket keeps the same human-facing name.
 */
export function validateBasketApproval(
  approval: BasketApproval,
  basket: CandidateBasket,
): ApprovalValidation {
  if (approval.status !== "APPROVED") return { valid: false, reason: "NOT_APPROVED" };
  return validateBasketForApproval(approval, basket);
}

/**
 * A material basket mutation invalidates the previous approval and issues the
 * next version. An identical basket is left at the existing version.
 */
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
