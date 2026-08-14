import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
  type ReconciledInventoryBaseline,
} from "./inventory-reconciliation";
import {
  auditInventoryBaseline,
  type InventoryBaselineAudit,
  type InventoryBaselineRow,
} from "./inventory-baseline";

/** Exact Airtable INVENTORY RECONCILIATIONS field contract. */
export const INVENTORY_RECONCILIATION_FIELDS = [
  "Reconciliation",
  "Inventory record ID",
  "Disposition",
  "Reason",
  "Evidence",
  "Source",
  "Recorded at",
] as const;

export interface InventoryReconciliationRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface InventoryReconciliationSource {
  listRows(): Promise<InventoryReconciliationRow[]>;
}

const DISPOSITIONS: readonly InventoryBaselineReconciliation["disposition"][] = [
  "CONFIRM_RECORDED_QUANTITY",
  "QUARANTINED_NON_STOCK",
  "DISCARDED",
];

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** Strictly maps canonical control-plane reconciliation rows into the domain decision model. */
export function mapInventoryReconciliationRow(
  row: InventoryReconciliationRow,
): InventoryBaselineReconciliation {
  const f = row.fields ?? {};
  const recordId = text(f["Inventory record ID"]);
  const disposition = text(f["Disposition"]) as InventoryBaselineReconciliation["disposition"] | null;
  const reason = text(f["Reason"]);
  const evidence = text(f["Evidence"]);

  if (!recordId) throw new Error(`Reconciliation ${row.id} has no Inventory record ID.`);
  if (!disposition || !DISPOSITIONS.includes(disposition)) {
    throw new Error(`Reconciliation ${row.id} has an invalid disposition.`);
  }
  if (!reason) throw new Error(`Reconciliation ${row.id} has no reason.`);
  if (!evidence) throw new Error(`Reconciliation ${row.id} has no evidence.`);

  return { recordId, disposition, reason, evidence };
}

/** Fresh-session boundary: read the complete durable reconciliation set deterministically. */
export async function readInventoryBaselineReconciliations(
  source: InventoryReconciliationSource,
): Promise<InventoryBaselineReconciliation[]> {
  const rows = await source.listRows();
  const decisions = rows.map(mapInventoryReconciliationRow);
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (seen.has(decision.recordId)) {
      throw new Error(`Duplicate reconciliation for inventory record: ${decision.recordId}`);
    }
    seen.add(decision.recordId);
  }
  return decisions.sort((a, b) =>
    `${a.recordId}\u0000${a.disposition}\u0000${a.reason}\u0000${a.evidence}`.localeCompare(
      `${b.recordId}\u0000${b.disposition}\u0000${b.reason}\u0000${b.evidence}`,
    ),
  );
}

/**
 * Fresh-session consumption seam used by the baseline workflow. It reads
 * durable reconciliation evidence first, then applies only those explicit
 * decisions to the immutable INVENTORY snapshot. It cannot write INVENTORY or
 * HOUSEHOLD EVENTS.
 */
export async function buildReconciledInventoryBaselineFromSource(
  inventoryRows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
  reconciliationSource: InventoryReconciliationSource,
): Promise<ReconciledInventoryBaseline> {
  const decisions = await readInventoryBaselineReconciliations(reconciliationSource);
  return applyInventoryBaselineReconciliations(inventoryRows, baselineTimestamp, decisions);
}

/** Read-only acceptance audit for a fresh session consuming the durable decision set. */
export async function auditReconciledInventoryBaselineFromSource(
  inventoryRows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
  reconciliationSource: InventoryReconciliationSource,
): Promise<InventoryBaselineAudit & { reconciliationDecisionCount: number; reconciledReady: boolean }> {
  const decisions = await readInventoryBaselineReconciliations(reconciliationSource);
  const reconciled = applyInventoryBaselineReconciliations(
    inventoryRows,
    baselineTimestamp,
    decisions,
  );
  const audit = auditInventoryBaseline(inventoryRows, reconciled);
  const ready = isReconciledBaselineReady(reconciled);
  const exceptionsByCode = reconciled.unresolvedExceptions.reduce(
    (counts, exception) => {
      counts[exception.code] += 1;
      return counts;
    },
    {
      MISSING_ITEM: 0,
      MISSING_QUANTITY: 0,
      INVALID_QUANTITY: 0,
      OUT_OF_STOCK: 0,
      DUPLICATE_SOURCE_RECORD: 0,
      QUALIFIED_AMBIGUOUS_EVIDENCE: 0,
    } as InventoryBaselineAudit["exceptionsByCode"],
  );

  return {
    ...audit,
    exceptionCount: reconciled.unresolvedExceptions.length,
    exceptionsByCode,
    reconciliationDecisionCount: decisions.length,
    reconciledReady: ready,
    readyForAuthority: ready,
    readinessReason: ready
      ? "Fresh-session reconciliation source consumed successfully; no unresolved baseline exceptions remain."
      : `${reconciled.unresolvedExceptions.length} baseline exception(s) remain after applying durable reconciliation decisions.`,
  };
}
