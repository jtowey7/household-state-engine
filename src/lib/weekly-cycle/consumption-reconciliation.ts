import { reconcileConsumptionPlan } from "../consumption/reconciliation";
import type { ConsumptionEvidence } from "../expected-state";
import { runWeeklyShadowCycle } from "./cycle";
import type { WeeklyCycleOptions, WeeklyCycleRun } from "./types";

export interface WeeklyConsumptionReconciliationRun {
  weekly: WeeklyCycleRun;
  reconciliation: ReturnType<typeof reconcileConsumptionPlan> | null;
  deterministic: boolean;
  inputUnchanged: boolean;
  nonMutating: true;
}

/**
 * Composes the proven weekly shadow cycle with the expected-vs-confirmed
 * consumption reconciliation boundary. This is a read-only acceptance seam:
 * it does not replace the weekly cycle's planning replay or create household
 * writes. It proves that confirmed consumption can be derived from the same
 * opening state + planned meals before downstream quantity decisions consume
 * the reconciled handoff.
 */
export async function runWeeklyShadowCycleWithConsumptionReconciliation(
  options: WeeklyCycleOptions,
  evidence: readonly ConsumptionEvidence[],
): Promise<WeeklyConsumptionReconciliationRun> {
  const planBefore = JSON.stringify(options.plan);
  const evidenceBefore = JSON.stringify(evidence);
  const weekly = await runWeeklyShadowCycle(options);

  if (!weekly.source?.ok) {
    return {
      weekly,
      reconciliation: null,
      deterministic: true,
      inputUnchanged: JSON.stringify(options.plan) === planBefore && JSON.stringify(evidence) === evidenceBefore,
      nonMutating: true,
    };
  }

  const plan = {
    ...options.plan,
    openingEvents: weekly.source.openingEvents,
  };
  const reconcileOptions = {
    asOf: options.asOf,
    ...(options.now ? { now: options.now } : {}),
  };
  const first = reconcileConsumptionPlan(plan, evidence, reconcileOptions);
  const second = reconcileConsumptionPlan(plan, evidence, reconcileOptions);

  return {
    weekly,
    reconciliation: first,
    deterministic: JSON.stringify(first) === JSON.stringify(second),
    inputUnchanged: JSON.stringify(options.plan) === planBefore && JSON.stringify(evidence) === evidenceBefore,
    nonMutating: true,
  };
}
