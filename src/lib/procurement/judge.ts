import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";

export type BasketJudgeVerdict = "PASS" | "NEEDS_REVIEW" | "REFUSE";

export interface BasketJudgeResult {
  judgeId: string;
  basketId: string;
  verdict: BasketJudgeVerdict;
  readyForApproval: boolean;
  tradeoffs: string[];
  reasons: string[];
}

/**
 * Deterministic pre-approval judge for one candidate basket.
 *
 * This is deliberately a gate, not an LLM or price-optimisation model: it
 * verifies coverage, sourcing and provenance and exposes material trade-offs.
 * It never approves, purchases or mutates household state.
 */
export function judgeCandidateBasket(basket: CandidateBasket): BasketJudgeResult {
  const reasons: string[] = [];
  const tradeoffs: string[] = [];

  if (basket.lines.length === 0) {
    reasons.push("Basket contains no purchasable lines.");
  }
  if (!basket.complete) {
    reasons.push(
      `Basket is incomplete: ${basket.coverage.unsourcedItemKeys.length} demanded item(s) lack a verified product source.`,
    );
  }
  if (basket.exceptions.length > 0) {
    reasons.push(`Basket has ${basket.exceptions.length} sourcing/procurement exception(s).`);
  }
  for (const line of basket.lines) {
    if (line.sourceEventIds.length === 0) {
      reasons.push(`Line "${line.itemKey}" has no source event provenance.`);
    }
    if (line.packCount < 1 || line.orderedQuantity <= 0 || line.lineCost < 0) {
      reasons.push(`Line "${line.itemKey}" has invalid pack or cost arithmetic.`);
    }
  }

  if (basket.coverage.unsourcedItemKeys.length > 0) {
    tradeoffs.push(
      `Coverage gap: ${basket.coverage.unsourcedItemKeys.join(", ")}; do not treat the basket as a complete shopping recommendation.`,
    );
  }
  if (basket.lines.length > 0) {
    tradeoffs.push(
      `Basket total is £${basket.totalCost.toFixed(2)} across ${basket.lines.length} sourced line(s); pack rounding may create surplus.`,
    );
  }
  if (basket.retailer) tradeoffs.push(`Retailer constrained to ${basket.retailer}.`);

  const structuralFailure = reasons.some((reason) => reason.includes("no source event provenance") || reason.includes("invalid pack or cost arithmetic"));
  const verdict: BasketJudgeVerdict = structuralFailure
    ? "REFUSE"
    : basket.complete && basket.exceptions.length === 0 && basket.lines.length > 0
      ? "PASS"
      : "NEEDS_REVIEW";

  return {
    judgeId: hashOf({
      basketId: basket.basketId,
      verdict,
      reasons,
      tradeoffs,
    }),
    basketId: basket.basketId,
    verdict,
    readyForApproval: verdict === "PASS" && basket.readyForApproval,
    tradeoffs,
    reasons,
  };
}
