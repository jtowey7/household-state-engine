/**
 * Food OS — governed learning runtime composition.
 *
 * Composes the existing reconciliation -> observation adapter -> variance
 * analyser into one deterministic, proposal-only application seam.
 *
 * This module deliberately does not write household state, promote a learning
 * proposal into a preference/rule, or dispatch any downstream action.
 */

import { hashOf } from "../state-engine/hash";
import type { ConsumptionEvidence, ReconciliationRun } from "../expected-state/types";
import { observationsFromReconciliation } from "./from-reconciliation";
import { analyseInventoryOutcomes, type LearningOptions, type LearningResult, type OutcomeObservation } from "./variance";

export interface GovernedLearningRun {
  runId: string;
  observations: OutcomeObservation[];
  result: LearningResult;
  /** Learning is advisory until an independent human-authorised promotion step exists. */
  proposalOnly: true;
  readonly mutatedHouseholdState: false;
  readonly promoted: false;
}

/**
 * Turn an already-computed reconciliation into the existing governed learning
 * result. The reconciliation remains authoritative; no second expectation or
 * evidence model is created here.
 */
export function runGovernedLearning(
  reconciliation: Pick<ReconciliationRun, "entries">,
  evidence: readonly ConsumptionEvidence[],
  options: LearningOptions & { runId?: string } = {},
): GovernedLearningRun {
  const observations = observationsFromReconciliation(reconciliation, evidence);
  const result = analyseInventoryOutcomes(observations, options);
  const runId = options.runId ?? hashOf({
    entries: reconciliation.entries,
    evidence,
    learning: options,
  });

  return {
    runId,
    observations,
    result,
    proposalOnly: true,
    mutatedHouseholdState: false,
    promoted: false,
  };
}
