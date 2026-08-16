import { judgeCandidateBasket, type BasketJudgeResult } from "../procurement/judge";
import { runWeeklyShadowCycle } from "./cycle";
import type { WeeklyCycleOptions, WeeklyCycleRun } from "./types";

export interface JudgedWeeklyCycleRun extends WeeklyCycleRun {
  /** Deterministic pre-approval result; approval/purchase remain outside the runtime. */
  basketJudge: BasketJudgeResult | null;
}

/**
 * Runs the existing shadow weekly cycle and applies the deterministic basket
 * judge to its candidate basket. The judge is pure/read-only: it cannot
 * approve, purchase, dispatch, or mutate household state.
 *
 * This is intentionally a thin integration seam so the existing cycle remains
 * the canonical orchestrator while the basket judge becomes an explicit gate
 * before human approval.
 */
export async function runJudgedWeeklyShadowCycle(
  options: WeeklyCycleOptions,
): Promise<JudgedWeeklyCycleRun> {
  const cycle = await runWeeklyShadowCycle(options);
  const basketJudge = cycle.basket ? judgeCandidateBasket(cycle.basket) : null;

  return {
    ...cycle,
    basketJudge,
  };
}
