import { hashOf } from "./hash";
import {
  reconciliationKeyFor,
  type InventoryReconciliationStore,
  type PersistedInventoryReconciliation,
} from "./inventory-reconciliation-persistence";
import type { InventoryBaselineDisposition } from "./inventory-reconciliation";

export interface AirtableReconciliationRow {
  id: string;
  fields: Record<string, unknown>;
}

/** Read/create-only connector contract for INVENTORY RECONCILIATIONS. */
export interface AirtableReconciliationPort {
  listReconciliations(): Promise<AirtableReconciliationRow[]>;
  createReconciliation(fields: Record<string, unknown>): Promise<void>;
}

export const INVENTORY_RECONCILIATION_FIELDS = [
  "Reconciliation",
  "Inventory record ID",
  "Disposition",
  "Reason",
  "Evidence",
  "Source",
  "Recorded at",
] as const;

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function mapDisposition(value: unknown): InventoryBaselineDisposition | null {
  const raw = str(value);
  if (
    raw === "CONFIRM_RECORDED_QUANTITY" ||
    raw === "QUARANTINED_NON_STOCK" ||
    raw === "DISCARDED"
  ) {
    return raw;
  }
  return null;
}

function mapRow(row: AirtableReconciliationRow): PersistedInventoryReconciliation | null {
  const recordId = str(row.fields["Inventory record ID"]);
  const disposition = mapDisposition(row.fields["Disposition"]);
  const reason = str(row.fields["Reason"]);
  const evidence = str(row.fields["Evidence"]);
  const reconciliation = str(row.fields["Reconciliation"]);

  if (!recordId || !disposition || !reason || !evidence || !reconciliation) return null;

  const reconciliationKey = reconciliationKeyFor(recordId);
  if (reconciliation !== reconciliationKey) return null;

  const payloadHash = hashOf({
    recordId,
    disposition,
    reason,
    evidence,
  });

  return {
    recordId,
    disposition,
    reason,
    evidence,
    reconciliationKey,
    payloadHash,
  };
}

/**
 * Adapter for the real Airtable control-plane table. It deliberately has no
 * update/delete path: reconciliation decisions are immutable evidence.
 */
export class AirtableInventoryReconciliationStore implements InventoryReconciliationStore {
  constructor(private readonly port: AirtableReconciliationPort) {}

  async findByKey(reconciliationKey: string): Promise<PersistedInventoryReconciliation | null> {
    const matches = (await this.port.listReconciliations())
      .map(mapRow)
      .filter((row): row is PersistedInventoryReconciliation => row !== null)
      .filter((row) => row.reconciliationKey === reconciliationKey);

    if (matches.length > 1) {
      throw new Error(`Multiple durable reconciliation records exist for ${reconciliationKey}.`);
    }
    return matches[0] ?? null;
  }

  async append(record: PersistedInventoryReconciliation): Promise<void> {
    await this.port.createReconciliation({
      "Reconciliation": record.reconciliationKey,
      "Inventory record ID": record.recordId,
      "Disposition": record.disposition,
      "Reason": record.reason,
      "Evidence": record.evidence,
      "Source": "FoodOS reconciliation persistence",
      "Recorded at": new Date().toISOString(),
    });
  }

  async list(): Promise<PersistedInventoryReconciliation[]> {
    return (await this.port.listReconciliations())
      .map(mapRow)
      .filter((row): row is PersistedInventoryReconciliation => row !== null)
      .sort((a, b) => a.recordId.localeCompare(b.recordId));
  }
}
