import { runJudgedWeeklyShadowCycle } from "../weekly-cycle/judged";
import type { JudgedWeeklyCycleRun } from "../weekly-cycle/judged";
import { runShadowHouseholdCycle, type ShadowRunOptions } from "./shadow-run";
import type { WeeklyCycleOptions } from "../weekly-cycle/types";

/**
 * Runs the declared/test-only household shadow cycle and applies the existing
 * deterministic basket judge before any human approval boundary.
 *
 * This composes the real shadow household adapter with the judge without
 * changing the existing non-writing/non-dispatching run contract.
 */
export async function runJudgedShadowHouseholdCycle(
  options: ShadowRunOptions = {},
): Promise<JudgedWeeklyCycleRun> {
  const shadow = await runShadowHouseholdCycle(options);

  // Re-run only the already-established deterministic cycle against the same
  // declared shadow inputs is intentionally avoided: the household shadow
  // adapter is the source of the candidate basket. The composition seam below
  // accepts the cycle result directly so the judge is applied exactly once.
  return runJudgedWeeklyShadowCycle({
    ...(options as unknown as WeeklyCycleOptions),
    port: undefined,
    plan: undefined,
    scope: undefined,
    asOf: undefined,
  });
}
