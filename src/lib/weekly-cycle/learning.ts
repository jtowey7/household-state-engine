import type { ConsumptionEvidence } from "../expected-state";
import { runGovernedLearning, type GovernedLearningRun } from "../learning/runtime";
import { runWeeklyShadowCycleWithConsumptionReconciliation } from "./consumption-reconciliation";
import type { WeeklyCycleOptions } from "./types";

export interface WeeklyLearningRun {
  weekly: Awaited<ReturnType<typeof runWeeklyShadowCycleWithConsumptionReconciliation>>;
  learning: GovernedLearningRun | null;
  deterministic: boolean;
  nonMutating: true;
  proposalOnly: true;
}

/**
 * Compose the existing weekly reconciliation path with the governed learning
 * runtime. Reconciliation remains authoritative and learning remains
 * proposal-only; this function adds orchestration only.
 */
export async function runWeeklyShadowCycleWithLearning(
  options: WeeklyCycleOptions,
  evidence: readonly ConsumptionEvidence[],
): Promise<WeeklyLearningRun> {
  const first = await runWeeklyShadowCycleWithConsumptionReconciliation(options, evidence);

  if (!first.reconciliation) {
    return {
      weekly: first,
      learning: null,
      deterministic: first.deterministic,
      nonMutating: true,
      proposalOnly: true,
    };
  }

  const learning = runGovernedLearning(first.reconciliation, evidence);
  const second = runGovernedLearning(first.reconciliation, evidence);

  return {
    weekly: first,
    learning,
    deterministic: first.deterministic && JSON.stringify(learning) === JSON.stringify(second),
    nonMutating: true,
    proposalOnly: true,
  };
}
