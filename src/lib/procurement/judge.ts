import { hashOf } from "../state-engine/hash";
import { validateBasketIntegrity } from "./integrity";
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
 * Phase 4 owns structural basket integrity; this Phase 5 judge consumes that
 * result and adds decision-level review/refusal semantics. It never approves,
 * purchases or mutates household state.
 */
export function judgeCandidateBasket(basket: CandidateBasket): BasketJudgeResult {
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  const integrityFindings = validateBasketIntegrity(basket);
  const fatalExceptions = basket.exceptions.filter((exception) => exception.fatal);
  const lineKeys = new Set(basket.lines.map((line) => line.itemKey));
  const sourcedCoverageWithoutLines = basket.coverage.sourcedItemKeys.filter((itemKey) => !lineKeys.has(itemKey));

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
  if (fatalExceptions.length > 0) {
    reasons.push(
      `${fatalExceptions.length} material procurement exception(s) prevent the basket from being approved.`,
    );
  }
  if (sourcedCoverageWithoutLines.length > 0) {
    reasons.push(
      `Basket marks sourced item(s) without corresponding basket line(s): ${sourcedCoverageWithoutLines.join(", ")}.`,
    );
  }

  reasons.push(...integrityFindings.map((finding) => finding.detail));

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

  const verdict: BasketJudgeVerdict =
    integrityFindings.length > 0 || fatalExceptions.length > 0 || sourcedCoverageWithoutLines.length > 0
      ? "REFUSE"
      : basket.complete && basket.exceptions.length === 0 && basket.lines.length > 0
        ? "PASS"
        : "NEEDS_REVIEW";

  return {
    // Judge provenance must bind to the exact basket state that was judged.
    // A basket mutation that leaves verdict/reasons/tradeoffs unchanged must
    // still produce a different judgeId.
    judgeId: hashOf({
      basket,
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
