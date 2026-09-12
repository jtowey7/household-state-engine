/**
 * Pure planner for Production INVENTORY materialisation.
 *
 * Deterministic and I/O free: given a loaded read-only production state, the
 * replay snapshot, the existing INVENTORY rows and an explicit human approval,
 * it decides exactly which rows would change. It fabricates nothing.
 */

import { hashOf } from "../state-engine/hash";
import type { StateSnapshot } from "../state-engine/types";
import type { LoadedProductionState } from "../production-adapter/types";
import type {
  InventoryRow,
  MaterialisationApproval,
  MaterialisationDecision,
  MaterialisationLine,
} from "./types";

const AUTOMATED_PRINCIPAL = /(?:scheduler|agent|bot|workflow|automation|system)/i;

export const MATERIALISATION_STAMP_PREFIX = "foodOS materialisation";

function normaliseItem(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function materialisationStamp(input: {
  materialisationId: string;
  snapshotId: string;
  replayId: string;
  contributingEventIds: string[];
}): string {
  return [
    `${MATERIALISATION_STAMP_PREFIX} ${input.materialisationId}`,
    `snapshot ${input.snapshotId}`,
    `replay ${input.replayId}`,
    `events ${input.contributingEventIds.join(",")}`,
  ].join(" · ");
}

export function planInventoryMaterialisation(input: {
  loaded: LoadedProductionState;
  snapshot: StateSnapshot;
  existingInventory: InventoryRow[];
  approval: MaterialisationApproval;
}): MaterialisationDecision {
  const { loaded, snapshot, existingInventory, approval } = input;

  if (!loaded.ok) {
    return { ok: false, code: "SOURCE_LOAD_FAILED", detail: "The read-only production load was fatally rejected." };
  }

  if (!approval || !nonEmpty(approval.approvalId) || !nonEmpty(approval.approvedBy) || !nonEmpty(approval.approvedAt)) {
    return { ok: false, code: "MISSING_HUMAN_APPROVAL", detail: "An explicit human approval is mandatory." };
  }
  if (AUTOMATED_PRINCIPAL.test(approval.approvedBy)) {
    return { ok: false, code: "AUTOMATED_APPROVAL_REJECTED", detail: "Automated principals cannot approve materialisation." };
  }
  if (approval.expectedSnapshotId !== snapshot.snapshotId || approval.expectedReplayId !== snapshot.replayId) {
    return {
      ok: false,
      code: "APPROVAL_BINDING_MISMATCH",
      detail: "Approval is bound to a different snapshot/replay than the one replayed now.",
    };
  }

  const canonicalStatus = snapshot.canonicalReconciliationStatus ?? snapshot.reconciliationStatus;
  if (canonicalStatus === "BLOCKED" || snapshot.blockedItemKeys.length > 0) {
    return {
      ok: false,
      code: "RECONCILIATION_BLOCKED",
      detail: `Unresolved conflicts block materialisation (${snapshot.blockedItemKeys.join(", ") || "snapshot blocked"}).`,
    };
  }

  if (snapshot.contributingEventIds.length === 0) {
    return { ok: false, code: "NO_CANONICAL_EVENTS", detail: "No canonical Production events were applied; nothing to materialise." };
  }

  const applicable = snapshot.items
    .filter((item) => !item.removed && !item.blocked)
    .slice()
    .sort((a, b) => a.itemKey.localeCompare(b.itemKey));

  for (const item of applicable) {
    if (!nonEmpty(item.unit) || !Number.isFinite(item.quantity)) {
      return {
        ok: false,
        code: "INCOMPLETE_MATERIALISED_ITEM",
        detail: `Item ${item.itemKey} has no canonical quantity/unit; refusing to invent one.`,
      };
    }
  }

  const byItem = new Map<string, InventoryRow>();
  for (const row of existingInventory) {
    const key = normaliseItem(row.item);
    if (!key) continue;
    if (byItem.has(key)) {
      return {
        ok: false,
        code: "AMBIGUOUS_INVENTORY_TARGET",
        detail: `INVENTORY holds more than one row for "${row.item}"; refusing to guess which to materialise into.`,
      };
    }
    byItem.set(key, row);
  }

  const materialisationId = hashOf({
    snapshotId: snapshot.snapshotId,
    replayId: snapshot.replayId,
    items: applicable.map((item) => ({
      itemKey: item.itemKey,
      quantity: item.quantity,
      unit: item.unit,
      contributingEventIds: item.contributingEventIds,
    })),
  });

  const lines: MaterialisationLine[] = applicable.map((item) => {
    const notes = materialisationStamp({
      materialisationId,
      snapshotId: snapshot.snapshotId,
      replayId: snapshot.replayId,
      contributingEventIds: item.contributingEventIds,
    });
    const existing = byItem.get(normaliseItem(item.itemKey));
    const alreadyStamped = typeof existing?.notes === "string" && existing.notes.includes(`${MATERIALISATION_STAMP_PREFIX} ${materialisationId}`);
    const operation = !existing ? "CREATE" : alreadyStamped ? "UNCHANGED" : "UPDATE";

    return {
      itemKey: item.itemKey,
      quantity: item.quantity,
      unit: item.unit as string,
      removed: false,
      contributingEventIds: item.contributingEventIds,
      operation,
      targetRecordId: existing?.recordId ?? null,
      notes,
    };
  });

  const writes = lines.filter((line) => line.operation !== "UNCHANGED");

  return {
    ok: true,
    materialisationId,
    snapshotId: snapshot.snapshotId,
    replayId: snapshot.replayId,
    replayTimestamp: snapshot.replayTimestamp,
    approvalId: approval.approvalId,
    lines,
    writes,
    eventIdsToMarkReplayed: snapshot.contributingEventIds.slice(),
    alreadyMaterialised: writes.length === 0,
  };
}
