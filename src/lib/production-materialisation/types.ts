/**
 * Food OS — Production INVENTORY materialisation seam (narrow MVP cutover).
 *
 * Scope boundary:
 * - HOUSEHOLD EVENTS are NEVER created, appended or edited here. The only
 *   event-row mutation permitted is flipping `Replay status` to Applied, and
 *   only after the materialised INVENTORY write has fully succeeded.
 * - INVENTORY values are never invented: every written quantity/unit comes
 *   from `replayEvents()` output, with the contributing Event IDs, snapshot ID
 *   and replay ID stamped as provenance.
 * - Unresolved conflicts fail the whole run closed; nothing is partially
 *   materialised on a blocked snapshot.
 */

export type MaterialisationRefusalCode =
  /** The read-only production load failed or was fatally rejected. */
  | "SOURCE_LOAD_FAILED"
  /** No canonical Production events to materialise. */
  | "NO_CANONICAL_EVENTS"
  /** Unresolved conflict / blocked item in the snapshot. */
  | "RECONCILIATION_BLOCKED"
  /** No explicit human approval was supplied. */
  | "MISSING_HUMAN_APPROVAL"
  /** An automated principal attempted to self-approve. */
  | "AUTOMATED_APPROVAL_REJECTED"
  /** Approval is bound to a different snapshot/replay than the one loaded. */
  | "APPROVAL_BINDING_MISMATCH"
  /** Two existing INVENTORY rows claim the same item; refuse to guess. */
  | "AMBIGUOUS_INVENTORY_TARGET"
  /** A materialised item has no usable unit. */
  | "INCOMPLETE_MATERIALISED_ITEM";

export interface MaterialisationApproval {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  /** Must equal the snapshot actually produced by replay. */
  expectedSnapshotId: string;
  /** Must equal the replay identity actually produced by replay. */
  expectedReplayId: string;
}

export interface InventoryRow {
  recordId: string;
  item: string;
  quantity: number;
  unit: string;
  status?: string | null;
  notes?: string | null;
}

export type MaterialisationOperation = "CREATE" | "UPDATE" | "UNCHANGED";

export interface MaterialisationLine {
  itemKey: string;
  quantity: number;
  unit: string;
  removed: boolean;
  contributingEventIds: string[];
  operation: MaterialisationOperation;
  targetRecordId: string | null;
  /** Provenance stamp written into the INVENTORY row. */
  notes: string;
}

export interface MaterialisationPlan {
  ok: true;
  /** Deterministic identity of this materialisation (snapshot + values). */
  materialisationId: string;
  snapshotId: string;
  replayId: string;
  replayTimestamp: string;
  approvalId: string;
  lines: MaterialisationLine[];
  /** Subset of lines that require an INVENTORY write. */
  writes: MaterialisationLine[];
  /** Event IDs whose `Replay status` becomes Applied after a successful write. */
  eventIdsToMarkReplayed: string[];
  /** True when every line was already written by an earlier identical run. */
  alreadyMaterialised: boolean;
}

export type MaterialisationDecision =
  | MaterialisationPlan
  | { ok: false; code: MaterialisationRefusalCode; detail: string };

export interface MaterialisationPort {
  readonly portId: string;
  listInventory(): Promise<InventoryRow[]>;
  createInventoryRow(line: MaterialisationLine): Promise<{ recordId: string }>;
  updateInventoryRow(recordId: string, line: MaterialisationLine): Promise<void>;
  /** Must be idempotent: rows already Applied are left untouched. */
  markEventsReplayed(eventIds: string[]): Promise<{ updatedEventIds: string[] }>;
}

export type MaterialisationExecution =
  | {
      ok: true;
      materialisationId: string;
      created: number;
      updated: number;
      unchanged: number;
      replayStatusUpdatedEventIds: string[];
    }
  | {
      ok: false;
      code: "INVENTORY_WRITE_FAILED" | "REPLAY_STATUS_UPDATE_FAILED";
      detail: string;
      materialisationId: string;
      created: number;
      updated: number;
      /** Always false when the inventory write failed: no event was flipped. */
      replayStatusUpdated: boolean;
    };
