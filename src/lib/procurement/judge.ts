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

  const demandedKeys = new Set(basket.coverage.demandItemKeys);
  const sourcedKeys = new Set(basket.coverage.sourcedItemKeys);
  const unsourcedKeys = new Set(basket.coverage.unsourcedItemKeys);
  const lineKeys = new Set(basket.lines.map((line) => line.itemKey));
  const coveredKeys = new Set([...sourcedKeys, ...unsourcedKeys]);
  const duplicateLineKeys = basket.lines
    .map((line) => line.itemKey)
    .filter((itemKey, index, keys) => keys.indexOf(itemKey) !== index);

  if (basket.coverage.complete !== basket.complete) {
    reasons.push("Basket coverage completion flag does not match basket completion.");
  }
  if ([...coveredKeys].some((itemKey) => !demandedKeys.has(itemKey))) {
    reasons.push("Basket coverage contains an item that is not present in demand.");
  }
  if ([...sourcedKeys].some((itemKey) => !demandedKeys.has(itemKey))) {
    reasons.push("Basket coverage sources an item that is not present in demand.");
  }
  if ([...unsourcedKeys].some((itemKey) => !demandedKeys.has(itemKey))) {
    reasons.push("Basket coverage marks an item unsourced that is not present in demand.");
  }
  if (basket.complete && demandedKeys.size !== sourcedKeys.size) {
    reasons.push("Complete basket does not have one sourced coverage entry for every demanded item.");
  }
  if ([...lineKeys].some((itemKey) => !sourcedKeys.has(itemKey))) {
    reasons.push("Basket contains a line that is not represented in sourced coverage.");
  }
  if (duplicateLineKeys.length > 0) {
    reasons.push("Basket contains duplicate item lines.");
  }

  const lineTotal = basket.lines.reduce((sum, line) => sum + line.lineCost, 0);
  if (!Number.isFinite(basket.totalCost) || basket.totalCost < 0) {
    reasons.push("Basket has invalid total-cost arithmetic.");
  } else if (!Number.isFinite(lineTotal) || Math.abs(lineTotal - basket.totalCost) > 0.005) {
    reasons.push("Basket total does not reconcile to its line costs.");
  }

  for (const line of basket.lines) {
    if (line.sourceEventIds.length === 0) {
      reasons.push(`Line "${line.itemKey}" has no source event provenance.`);
    }
    if (
      !Number.isFinite(line.requiredQuantity) ||
      line.requiredQuantity <= 0 ||
      !Number.isFinite(line.packSize) ||
      line.packSize <= 0 ||
      !Number.isFinite(line.packCount) ||
      !Number.isFinite(line.orderedQuantity) ||
      line.orderedQuantity <= 0 ||
      line.orderedQuantity < line.requiredQuantity ||
      line.packUnit !== line.unit ||
      !Number.isFinite(line.lineCost) ||
      line.packCount < 1 ||
      line.lineCost < 0
    ) {
      reasons.push(`Line "${line.itemKey}" has invalid pack, quantity or cost arithmetic.`);
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

  const structuralFailure = reasons.some(
    (reason) =>
      reason.includes("no source event provenance") ||
      reason.includes("invalid pack, quantity or cost arithmetic") ||
      reason.includes("invalid total-cost arithmetic") ||
      reason.includes("does not reconcile to its line costs") ||
      reason.includes("coverage") ||
      reason.includes("duplicate item lines") ||
      reason.includes("represented in sourced coverage"),
  );
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
