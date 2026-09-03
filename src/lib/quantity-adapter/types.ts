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
import type { ItemKeyMapEntry } from "./item-key-map";

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
  /**
   * Optional evidence-backed recipe/household item identity map. When supplied,
   * aliases are canonicalised before replay subtraction and pack rounding.
   * Missing or incompatible mappings never trigger an inferred conversion.
   */
  itemKeyMap?: readonly ItemKeyMapEntry[];
  /**
   * REFUSE_RUN (default, conservative): any blocked/uncertain item refuses the
   * whole run. ISOLATE_ITEMS: blocked items are withheld line-by-line and
   * unrelated items keep planning. Blocked items are never procured either way.
   */
  blockedItemPolicy?: "REFUSE_RUN" | "ISOLATE_ITEMS";
  /** Extra item keys to withhold (e.g. UNCERTAIN_QUANTITY exceptions). */
  isolatedItemKeys?: readonly string[];
}

export type AdapterRejectionCode =
  | "MISSING_REPLAY_SNAPSHOT"
  | "RECONCILIATION_BLOCKED"
  | "RECONCILIATION_UNCERTAIN"
  | "ITEM_ISOLATED"
  | "AMBIGUOUS_ITEM_KEY_MAPPING"
  | "NON_POSITIVE_QUANTITY"
  | "UNIT_MISMATCH"
  | "NO_DEMAND_TARGET"
  | "DUPLICATE_DEMAND_TARGET"
  | "PACK_ROUNDING_INCOMPATIBLE";

export interface AdapterRejection {
  code: AdapterRejectionCode;
  itemKey: string | null;
  detail: string;
  /** Fatal rejections abort the whole run; otherwise only the line is dropped. */
  fatal: boolean;
}

export interface QuantityRequirement {
  /**
   * Deterministic identity of this requirement line. Carried into procurement
   * so every aggregated basket line traces back to its quantity requirements.
   * Optional only so hand-built fixtures stay valid; the adapter always sets it.
   */
  requirementId?: string;
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
