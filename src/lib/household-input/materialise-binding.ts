/**
 * Food OS — bind the person's own "save this" confirmation to the exact
 * deterministic snapshot their change produces.
 *
 * The existing INVENTORY materialisation contract refuses without a
 * `MaterialisationApproval` bound to the exact replay snapshot. Nothing here
 * weakens that: the snapshot is computed BEFORE anything is written, from the
 * real read-only event stream plus the exact canonical row the person is about
 * to approve. The person therefore approves the resulting state itself, and if
 * the stream has moved on by the time the write runs, the existing planner
 * refuses with APPROVAL_BINDING_MISMATCH.
 *
 * No writer, schema or authority is introduced in this file. It is read-only
 * and deterministic.
 */

import { loadProductionState } from "../production-adapter/adapter";
import type { AirtableRow, AirtableRowSource } from "../production-adapter/airtable-port";
import type { ProductionStatePort, SourceScope } from "../production-adapter/types";
import { replayEvents } from "../state-engine/engine";
import type { CanonicalAppendRecord } from "../event-writer/types";
import type { MaterialisationApproval } from "../production-materialisation/types";

/** What the household screen carries back with the person's confirmation. */
export interface HouseholdUpdateBinding {
  expectedSnapshotId: string;
  expectedReplayId: string;
  replayClock: string;
  windowStart: string;
  windowEnd: string;
  datasetId: string;
}

/**
 * A read-only view of the live event stream with the pending canonical rows
 * appended. The wrapper exposes `listEventRows` only, so it remains refused by
 * nothing and capable of nothing else.
 */
export function withPendingEventRows(
  source: AirtableRowSource,
  records: readonly CanonicalAppendRecord[],
): AirtableRowSource {
  const pending: AirtableRow[] = records.map((record) => ({
    id: `pending:${record.eventId}`,
    fields: record.row as unknown as Record<string, unknown>,
  }));
  return {
    baseLabel: source.baseLabel,
    provenance: source.provenance,
    async listEventRows(scope: SourceScope): Promise<AirtableRow[]> {
      const rows = await source.listEventRows(scope);
      return [...rows, ...pending];
    },
  };
}

export type HouseholdUpdateBindingResult =
  | { ok: true; binding: HouseholdUpdateBinding }
  | { ok: false; detail: string };

/**
 * Replay the real stream (plus the pending rows) read-only and return the
 * deterministic snapshot identity the person's confirmation will be bound to.
 */
export async function computeHouseholdUpdateBinding(input: {
  readPort: ProductionStatePort;
  scope: SourceScope;
  replayClock: string;
}): Promise<HouseholdUpdateBindingResult> {
  const loaded = await loadProductionState(input.readPort, input.scope);
  if (!loaded.ok) {
    return {
      ok: false,
      detail: "FoodOS could not read your food record just now, so it cannot prepare this update.",
    };
  }
  const snapshot = replayEvents(loaded.openingEvents, { now: () => input.replayClock });
  return {
    ok: true,
    binding: {
      expectedSnapshotId: snapshot.snapshotId,
      expectedReplayId: snapshot.replayId,
      replayClock: input.replayClock,
      windowStart: input.scope.windowStart,
      windowEnd: input.scope.windowEnd,
      datasetId: input.scope.datasetId,
    },
  };
}

/**
 * Turn the person's explicit confirmation into the approval the existing
 * materialisation contract demands. The snapshot/replay identity comes only
 * from the binding they were shown — never from whatever snapshot happens to
 * exist at write time.
 */
export function materialisationApprovalFromHouseholdConfirmation(
  binding: HouseholdUpdateBinding,
  confirmation: { approvalId: string; approvedBy: string; approvedAt: string },
): MaterialisationApproval {
  return {
    approvalId: confirmation.approvalId,
    approvedBy: confirmation.approvedBy,
    approvedAt: confirmation.approvedAt,
    expectedSnapshotId: binding.expectedSnapshotId,
    expectedReplayId: binding.expectedReplayId,
  };
}
