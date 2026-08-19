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
 * stored numeric quantity. A confirmation may also be recorded for an already
 * exact row as durable provenance; in that case it is a no-op against the
 * exception set. QUARANTINED_NON_STOCK and DISCARDED explicitly remove that
 * source row from stock events. Nothing is inferred from notes, status or
 * placeholder units.
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

    const exception = exceptionByRecordId.get(recordId);
    if (!exception && decision.disposition !== "CONFIRM_RECORDED_QUANTITY") {
      throw new Error(`Inventory record ${recordId} has no baseline exception to reconcile.`);
    }

    if (
      decision.disposition === "CONFIRM_RECORDED_QUANTITY" &&
      exception &&
      exception.code !== "QUALIFIED_AMBIGUOUS_EVIDENCE"
    ) {
      throw new Error(
        `Cannot confirm recorded quantity for ${recordId}: baseline exception ${exception.code} means there is no safely confirmable recorded quantity.`,
      );
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

  // Reconciled identity must remain stable when the same source snapshot is
  // replayed at a different observation time. Do not hash occurredAt or the
  // human-readable event note, both of which legitimately contain the run
  // timestamp. Identity is derived from stable event content plus decisions.
  const identityEvents = events.map((event) => ({
    eventId: event.eventId,
    itemKey: event.itemKey,
    quantity: event.payload.quantity,
    unit: event.payload.unit ?? "",
    evidencePrecision: event.payload.evidencePrecision,
    sourceRecordIds:
      typeof event.payload.note === "string"
        ? event.payload.note.match(/sourceRecordIds=([^;]+)/)?.[1] ?? ""
        : "",
  }));

  const baselineId = hashOf({
    originalBaselineId: baseline.baselineId,
    reconciliations,
    events: identityEvents,
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
