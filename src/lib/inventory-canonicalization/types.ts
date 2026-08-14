/**
 * Deterministic inventory canonicalisation.
 *
 * This module is deliberately pure and read-only: it groups logically identical
 * inventory records for presentation/calculation without mutating household state.
 * Source records and batch metadata remain attached so the aggregation is auditable
 * and reversible.
 */

export type InventoryUnitFamily = "COUNT" | "MASS" | "VOLUME" | "OTHER";

export interface InventoryRecord {
  recordId: string;
  item: string;
  quantity: number;
  unit: string;
  /** Optional explicit variant/brand/flavour discriminator. */
  variant?: string | null;
  location?: string | null;
  bestBefore?: string | null;
  source?: string | null;
  delivered?: string | null;
  notes?: string | null;
}

export interface InventoryBatch {
  recordId: string;
  quantity: number;
  unit: string;
  location: string | null;
  bestBefore: string | null;
  source: string | null;
  delivered: string | null;
  notes: string | null;
}

export interface CanonicalInventoryItem {
  identityKey: string;
  item: string;
  variant: string | null;
  unitFamily: InventoryUnitFamily;
  canonicalUnit: string;
  totalQuantity: number;
  sourceRecordIds: string[];
  batches: InventoryBatch[];
}

export interface InventoryCanonicalisationResult {
  items: CanonicalInventoryItem[];
  /** Records that cannot safely be aggregated are retained here, never guessed. */
  unmergeableRecordIds: string[];
}
