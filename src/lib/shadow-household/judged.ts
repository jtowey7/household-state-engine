import { judgeCandidateBasket, type BasketJudgeResult } from "../procurement/judge";
import { runShadowHouseholdCycle, type ShadowRunOptions } from "./shadow-run";
import type { WeeklyCycleRun } from "../weekly-cycle/types";

export interface JudgedShadowHouseholdCycleRun extends WeeklyCycleRun {
  /** Deterministic pre-approval result; approval/purchase remain outside the runtime. */
  basketJudge: BasketJudgeResult | null;
}

/**
 * Runs the declared/test-only household shadow cycle and applies the existing
 * deterministic basket judge before any human approval boundary.
 *
 * The household adapter remains the source of the candidate basket. The judge
 * is pure/read-only, so this composition cannot approve, purchase, dispatch or
 * mutate household state.
 */
export async function runJudgedShadowHouseholdCycle(
  options: ShadowRunOptions = {},
): Promise<JudgedShadowHouseholdCycleRun> {
  const shadow = await runShadowHouseholdCycle(options);
  const basketJudge = shadow.basket ? judgeCandidateBasket(shadow.basket) : null;

  return {
    ...shadow,
    basketJudge,
  };
}
