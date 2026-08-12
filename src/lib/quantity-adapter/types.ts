/**
 * Food OS — Replay → Quantity Requirements adapter (isolated seam).
 *
 * Scope boundary: this module accepts ONLY State Engine output
 * (StateSnapshot / QuantityRequirementsHandoff) and emits deterministic
 * quantity requirements shaped for the existing aggregation + pack-rounding
 * contract. It performs no I/O, and is not connected to Airtable or to real
 * household data.
 */

import type { ReconciliationStatus } from "../state-engine/types";

/** Deterministic, synthetic demand plan supplied by the caller. */
export interface DemandTarget {
  itemKey: string;
  /** Par level the household should hold, in `unit`. */
  targetQuantity: number;
  unit: string;
  /** Optional pack size used by the downstream pack-rounding logic. */
  packSize?: number;
  packUnit?: string;
}

export interface AdapterOptions {
  targets: readonly DemandTarget[];
}

export type AdapterRejectionCode =
  | "MISSING_REPLAY_SNAPSHOT"
  | "RECONCILIATION_BLOCKED"
  | "RECONCILIATION_UNCERTAIN"
  | "NON_POSITIVE_QUANTITY"
  | "UNIT_MISMATCH"
  | "NO_DEMAND_TARGET"
  | "PACK_ROUNDING_INCOMPATIBLE";

export interface AdapterRejection {
  code: AdapterRejectionCode;
  itemKey: string | null;
  detail: string;
  /** Fatal rejections abort the whole run; otherwise only the line is dropped. */
  fatal: boolean;
}

export interface QuantityRequirement {
  itemKey: string;
  /** Quantity to procure (target − on-hand), always > 0. */
  requiredQuantity: number;
  unit: string;
  onHandQuantity: number;
  targetQuantity: number;
  /** Provenance carried straight through from the replay snapshot. */
  sourceEventIds: string[];
  /** Pack-rounded procurement quantity, when a pack size is configured. */
  packSize: number | null;
  packCount: number | null;
  packRoundedQuantity: number | null;
}

export interface QuantityRunPlan {
  /** Replay identity is preserved verbatim from the snapshot. */
  replayId: string;
  snapshotId: string;
  replayTimestamp: string;
  reconciliationStatus: ReconciliationStatus;
  /** Deterministic hash of the emitted plan. */
  planId: string;
  /** True only when the plan may be handed to the procurement engine. */
  eligibleForProcurement: boolean;
  executed: boolean;
  requirements: QuantityRequirement[];
  rejections: AdapterRejection[];
  blockedItemKeys: string[];
}
