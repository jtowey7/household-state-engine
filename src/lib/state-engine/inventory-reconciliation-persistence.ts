import { hashOf } from "./hash";
import {
  applyInventoryBaselineReconciliations,
  type InventoryBaselineReconciliation,
  type ReconciledInventoryBaseline,
} from "./inventory-reconciliation";
import type { InventoryBaselineRow } from "./inventory-baseline";

/**
 * Durable control-plane representation of one explicit human reconciliation.
 * This is NOT household state and never changes INVENTORY or HOUSEHOLD EVENTS.
 */
export interface PersistedInventoryReconciliation extends InventoryBaselineReconciliation {
  reconciliationKey: string;
  payloadHash: string;
}

/**
 * Minimal append/read port for the canonical INVENTORY RECONCILIATIONS table.
 * The implementation may be Airtable, D1 or another approved control-plane
 * adapter. There is deliberately no update/delete operation.
 */
export interface InventoryReconciliationStore {
  findByKey(reconciliationKey: string): Promise<PersistedInventoryReconciliation | null>;
  append(record: PersistedInventoryReconciliation): Promise<void>;
  list(): Promise<PersistedInventoryReconciliation[]>;
}

export type ReconciliationPersistOutcome =
  | "APPENDED"
  | "DUPLICATE_NOOP"
  | "CONFLICT";

export interface ReconciliationPersistResult {
  outcome: ReconciliationPersistOutcome;
  reconciliationKey: string;
  payloadHash: string;
  conflict?: {
    existingPayloadHash: string;
    detail: string;
  };
}

export function reconciliationKeyFor(recordId: string): string {
  const id = recordId.trim();
  if (!id) throw new Error("Inventory reconciliation requires a source record ID.");
  return `INVENTORY_RECON:${id}`;
}

function payloadHashFor(decision: InventoryBaselineReconciliation): string {
  return hashOf({
    recordId: decision.recordId.trim(),
    disposition: decision.disposition,
    reason: decision.reason.trim(),
    evidence: decision.evidence.trim(),
  });
}

/**
 * Persist one explicit decision with create-only semantics.
 *
 * Same key + same payload is an idempotent no-op. Same key + different
 * payload is a hard conflict; the existing decision is never overwritten.
 */
export async function persistInventoryReconciliation(
  decision: InventoryBaselineReconciliation,
  store: InventoryReconciliationStore,
): Promise<ReconciliationPersistResult> {
  const recordId = decision.recordId.trim();
  const reason = decision.reason.trim();
  const evidence = decision.evidence.trim();
  if (!recordId) throw new Error("Inventory reconciliation requires a source record ID.");
  if (!reason || !evidence) {
    throw new Error(`Reconciliation for ${recordId} requires reason and evidence.`);
  }

  const normalized: InventoryBaselineReconciliation = {
    recordId,
    disposition: decision.disposition,
    reason,
    evidence,
  };
  const reconciliationKey = reconciliationKeyFor(recordId);
  const payloadHash = payloadHashFor(normalized);
  const existing = await store.findByKey(reconciliationKey);

  if (existing) {
    if (existing.payloadHash === payloadHash) {
      return { outcome: "DUPLICATE_NOOP", reconciliationKey, payloadHash };
    }
    return {
      outcome: "CONFLICT",
      reconciliationKey,
      payloadHash,
      conflict: {
        existingPayloadHash: existing.payloadHash,
        detail:
          `Reconciliation ${recordId} already exists with a different decision; overwrite is refused.`,
      },
    };
  }

  await store.append({ ...normalized, reconciliationKey, payloadHash });
  return { outcome: "APPENDED", reconciliationKey, payloadHash };
}

/**
 * Fresh-session read/consumption seam. The caller supplies only the current
 * INVENTORY snapshot and a persisted control-plane decision set; no prior
 * conversation state is consulted and no decisions are inferred from notes.
 */
export async function consumePersistedInventoryReconciliations(
  rows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
  store: InventoryReconciliationStore,
): Promise<ReconciledInventoryBaseline> {
  const persisted = await store.list();
  const decisions: InventoryBaselineReconciliation[] = persisted
    .map(({ reconciliationKey: _key, payloadHash: _hash, ...decision }) => decision)
    .sort((a, b) => a.recordId.localeCompare(b.recordId));

  return applyInventoryBaselineReconciliations(rows, baselineTimestamp, decisions);
}
