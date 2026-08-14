import {
  buildInventoryBaseline,
  type BaselineException,
  type InventoryBaseline,
  type InventoryBaselineRow,
} from "./inventory-baseline";
import { hashOf } from "./hash";

export type InventoryBaselineDisposition =
  | "QUARANTINED_NON_STOCK"
  | "DISCARDED";

export interface InventoryBaselineReconciliation {
  recordId: string;
  disposition: InventoryBaselineDisposition;
  reason: string;
  evidence: string;
}

export interface ReconciledInventoryBaseline extends InventoryBaseline {
  reconciliations: InventoryBaselineReconciliation[];
  unresolvedExceptions: BaselineException[];
}

/**
 * Applies only explicit human reconciliation decisions to a baseline audit.
 *
 * This is deliberately a pure, write-free seam. A decision can remove a
 * baseline exception from the unresolved set only when the source record is
 * present in the snapshot and the decision contains a disposition, reason and
 * evidence. Nothing is inferred from inventory notes, status or placeholder
 * units. Reconciled rows never create stock events.
 */
export function applyInventoryBaselineReconciliations(
  rows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
  decisions: readonly InventoryBaselineReconciliation[],
): ReconciledInventoryBaseline {
  const baseline = buildInventoryBaseline(rows, baselineTimestamp);
  const sourceRecordIds = new Set(rows.map((row) => row.recordId.trim()).filter(Boolean));
  const exceptionByRecordId = new Map(
    baseline.exceptions.map((exception) => [exception.recordId, exception]),
  );
  const seen = new Set<string>();
  const reconciliations: InventoryBaselineReconciliation[] = [];

  for (const decision of decisions) {
    const recordId = decision.recordId.trim();
    const reason = decision.reason.trim();
    const evidence = decision.evidence.trim();

    if (!recordId || !sourceRecordIds.has(recordId)) {
      throw new Error(`Reconciliation references an unknown inventory record: ${decision.recordId}`);
    }
    if (seen.has(recordId)) {
      throw new Error(`Duplicate reconciliation for inventory record: ${recordId}`);
    }
    if (!reason || !evidence) {
      throw new Error(`Reconciliation for ${recordId} requires reason and evidence.`);
    }
    if (!exceptionByRecordId.has(recordId)) {
      throw new Error(`Inventory record ${recordId} has no baseline exception to reconcile.`);
    }

    seen.add(recordId);
    reconciliations.push({
      recordId,
      disposition: decision.disposition,
      reason,
      evidence,
    });
  }

  reconciliations.sort((a, b) =>
    `${a.recordId}\u0000${a.disposition}\u0000${a.reason}\u0000${a.evidence}`.localeCompare(
      `${b.recordId}\u0000${b.disposition}\u0000${b.reason}\u0000${b.evidence}`,
    ),
  );

  const reconciledIds = new Set(reconciliations.map((decision) => decision.recordId));
  const unresolvedExceptions = baseline.exceptions.filter(
    (exception) => !reconciledIds.has(exception.recordId),
  );

  const baselineId = hashOf({
    originalBaselineId: baseline.baselineId,
    reconciliations,
  });

  return {
    ...baseline,
    baselineId,
    reconciliations,
    unresolvedExceptions,
  };
}

export function isReconciledBaselineReady(
  baseline: ReconciledInventoryBaseline,
): boolean {
  return baseline.unresolvedExceptions.length === 0;
}
