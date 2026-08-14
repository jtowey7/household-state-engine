import {
  buildInventoryBaseline,
  type BaselineException,
  type InventoryBaseline,
  type InventoryBaselineRow,
} from "./inventory-baseline";
import { hashOf } from "./hash";

export type InventoryBaselineDisposition =
  | "CONFIRM_RECORDED_QUANTITY"
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
 * CONFIRM_RECORDED_QUANTITY explicitly upgrades the qualified source evidence
 * for that source row to accepted baseline evidence; it does not change the
 * stored numeric quantity. QUARANTINED_NON_STOCK and DISCARDED explicitly
 * remove that source row from stock events. Nothing is inferred from notes,
 * status or placeholder units.
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

  const byRecordId = new Map(reconciliations.map((decision) => [decision.recordId, decision]));
  const unresolvedExceptions = baseline.exceptions.filter(
    (exception) => !byRecordId.has(exception.recordId),
  );
  const unresolvedIds = new Set(unresolvedExceptions.map((exception) => exception.recordId));
  const excludedIds = new Set(
    reconciliations
      .filter(
        (decision) =>
          decision.disposition === "QUARANTINED_NON_STOCK" || decision.disposition === "DISCARDED",
      )
      .map((decision) => decision.recordId),
  );

  // Rebuild event groups from the baseline's deterministic source provenance,
  // excluding explicitly non-stock/discarded rows and upgrading only groups
  // whose qualified source rows have all been explicitly reconciled.
  const sourceRows = rows.filter(
    (row) => row.recordId.trim() && !excludedIds.has(row.recordId.trim()),
  );
  const rebuilt = buildInventoryBaseline(sourceRows, baselineTimestamp);
  const events = rebuilt.events.map((event) => {
    const note = typeof event.payload.note === "string" ? event.payload.note : "";
    const sourceIds = note.match(/sourceRecordIds=([^;]+)/)?.[1]?.split(",").filter(Boolean) ?? [];
    const stillQualified = sourceIds.some((id) => unresolvedIds.has(id));
    return {
      ...event,
      payload: {
        ...event.payload,
        evidencePrecision: stillQualified ? "QUALIFIED_AMBIGUOUS" : "EXACT",
      },
    };
  });

  const baselineId = hashOf({
    originalBaselineId: baseline.baselineId,
    reconciliations,
    events,
    unresolvedExceptions,
  });

  return {
    ...baseline,
    baselineId,
    events,
    reconciliations,
    unresolvedExceptions,
  };
}

export function isReconciledBaselineReady(
  baseline: ReconciledInventoryBaseline,
): boolean {
  return baseline.unresolvedExceptions.length === 0;
}
