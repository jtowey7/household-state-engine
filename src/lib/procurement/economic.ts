import type { CandidateBasket } from "./types";

export const DEFAULT_BASKET_ECONOMICS = {
  targetBudget: 150,
  acceptableBudget: 175,
  approvalThreshold: 180,
} as const;

export type BasketEconomicStatus =
  | "WITHIN_TARGET"
  | "WITHIN_ACCEPTABLE"
  | "ABOVE_ACCEPTABLE"
  | "ABOVE_APPROVAL_THRESHOLD";

export interface BasketEconomicOptions {
  targetBudget?: number;
  acceptableBudget?: number;
  approvalThreshold?: number;
}

export interface BasketEconomicResult {
  basketId: string;
  status: BasketEconomicStatus;
  totalCost: number;
  targetBudget: number;
  acceptableBudget: number;
  approvalThreshold: number;
  varianceToTarget: number;
  requiresHumanApproval: boolean;
  reasons: string[];
}

/**
 * Deterministic Phase 3 economic gate for a candidate basket.
 *
 * This evaluates spend against the household's explicit budget bands. It does
 * not choose a basket, approve an order, evaluate retailer offers, or dispatch
 * anything. Those responsibilities remain in later Basket phases.
 */
export function validateBasketEconomics(
  basket: CandidateBasket,
  options: BasketEconomicOptions = {},
): BasketEconomicResult {
  const targetBudget = options.targetBudget ?? DEFAULT_BASKET_ECONOMICS.targetBudget;
  const acceptableBudget = options.acceptableBudget ?? DEFAULT_BASKET_ECONOMICS.acceptableBudget;
  const approvalThreshold = options.approvalThreshold ?? DEFAULT_BASKET_ECONOMICS.approvalThreshold;

  if (
    !Number.isFinite(targetBudget) ||
    targetBudget < 0 ||
    !Number.isFinite(acceptableBudget) ||
    acceptableBudget < targetBudget ||
    !Number.isFinite(approvalThreshold) ||
    approvalThreshold < acceptableBudget
  ) {
    throw new Error("INVALID_BUDGET_BANDS");
  }

  if (!Number.isFinite(basket.totalCost) || basket.totalCost < 0) {
    throw new Error("INVALID_BASKET_TOTAL");
  }

  if (basket.lines.some((line) => !Number.isFinite(line.lineCost) || line.lineCost < 0)) {
    throw new Error("INVALID_LINE_COST");
  }

  const lineTotal = basket.lines.reduce((sum, line) => sum + line.lineCost, 0);
  if (!Number.isFinite(lineTotal) || Math.abs(lineTotal - basket.totalCost) > 0.005) {
    throw new Error("BASKET_TOTAL_MISMATCH");
  }

  const totalCost = basket.totalCost;
  const varianceToTarget = Number((totalCost - targetBudget).toFixed(2));
  const reasons: string[] = [];

  let status: BasketEconomicStatus;
  if (totalCost <= targetBudget) {
    status = "WITHIN_TARGET";
  } else if (totalCost <= acceptableBudget) {
    status = "WITHIN_ACCEPTABLE";
    reasons.push(`Basket is £${varianceToTarget.toFixed(2)} above the £${targetBudget.toFixed(2)} target.`);
  } else if (totalCost <= approvalThreshold) {
    status = "ABOVE_ACCEPTABLE";
    reasons.push(
      `Basket is £${varianceToTarget.toFixed(2)} above the £${targetBudget.toFixed(2)} target and above the £${acceptableBudget.toFixed(2)} normally acceptable range.`,
    );
  } else {
    status = "ABOVE_APPROVAL_THRESHOLD";
    reasons.push(
      `Basket exceeds the explicit £${approvalThreshold.toFixed(2)} human-approval threshold by £${(totalCost - approvalThreshold).toFixed(2)}.`,
    );
  }

  return {
    basketId: basket.basketId,
    status,
    totalCost,
    targetBudget,
    acceptableBudget,
    approvalThreshold,
    varianceToTarget,
    requiresHumanApproval: totalCost > approvalThreshold,
    reasons,
  };
}
