/**
 * Food OS — expected/confirmed reconciliation -> learning observations.
 *
 * Pure adapter only. It consumes the existing reconciliation result and its
 * evidence, producing the existing governed learning input. It performs no
 * I/O, no household mutation and no proposal promotion.
 */

import type {
  ConsumptionEvidence,
  ReconciliationRun,
} from "../expected-state/types";
import type { OutcomeObservation } from "./variance";

/**
 * Extract one learning observation per reconciled expectation that has
 * sufficient observed/reported evidence and a known quantity.
 *
 * Reconciliation remains authoritative about expected vs confirmed quantity;
 * the evidence list supplies the observation timestamp. Multiple evidence
 * records for the same expectation are intentionally collapsed here so the
 * learning layer does not mistake corroboration within one expectation for
 * repeated household behaviour across expectations.
 */
export function observationsFromReconciliation(
  run: Pick<ReconciliationRun, "entries">,
  evidence: readonly ConsumptionEvidence[],
): OutcomeObservation[] {
  const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
  const observations: OutcomeObservation[] = [];

  for (const entry of run.entries) {
    if (entry.expectedQuantity === null || entry.confirmedQuantity === null) continue;
    if (entry.expectationId === null || entry.evidenceIds.length === 0) continue;
    if (entry.status !== "MATCHED" && entry.status !== "DIVERGED") continue;

    const supportingEvidence = entry.evidenceIds
      .map((id) => byId.get(id))
      .filter((item): item is ConsumptionEvidence => Boolean(item))
      .filter(
        (item) =>
          (item.confidence === "OBSERVED" || item.confidence === "REPORTED") &&
          item.observedQuantity !== null &&
          item.observedQuantity !== undefined &&
          item.unit !== null &&
          item.unit !== undefined,
      )
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

    const latest = supportingEvidence.at(-1);
    if (!latest) continue;

    observations.push({
      observationId: entry.expectationId,
      itemKey: entry.itemKey,
      expectedQuantity: entry.expectedQuantity,
      observedQuantity: entry.confirmedQuantity,
      unit: entry.unit ?? latest.unit,
      occurredAt: latest.observedAt,
      source: "consumption",
    });
  }

  return observations;
}
