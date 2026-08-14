import type { InventoryBaselineReconciliation, InventoryBaselineDisposition } from "./inventory-reconciliation";

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

const DISPOSITIONS: readonly InventoryBaselineDisposition[] = [
  "CONFIRM_RECORDED_QUANTITY",
  "QUARANTINED_NON_STOCK",
  "DISCARDED",
];

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/**
 * Strictly maps canonical control-plane reconciliation rows into the domain
 * decision model. No inventory quantity is read or inferred here: the
 * decision only changes whether the existing source quantity is accepted or
 * excluded.
 */
export function mapInventoryReconciliationRow(
  row: InventoryReconciliationRow,
): InventoryBaselineReconciliation {
  const f = row.fields ?? {};
  const recordId = text(f["Inventory record ID"]);
  const disposition = text(f["Disposition"]) as InventoryBaselineDisposition | null;
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

/**
 * Fresh-session boundary: read the complete reconciliation set and reject
 * duplicate decisions for the same canonical INVENTORY record. Ordering is
 * deterministic so the same Airtable snapshot produces the same decision set.
 */
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
