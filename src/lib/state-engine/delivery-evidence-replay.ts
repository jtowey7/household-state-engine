import { replayEvents } from "./engine";
import type { CanonicalAppendRecord } from "../event-writer/types";
import type { HouseholdEvent, StateSnapshot } from "./types";

export type DeliveryEvidenceReplayResult =
  | { ok: true; events: HouseholdEvent[]; snapshot: StateSnapshot }
  | { ok: false; code: "INVALID_CANONICAL_RECORD"; detail: string };

function toReplayEvent(record: CanonicalAppendRecord): HouseholdEvent | null {
  const row = record.row;
  if (row["Event type"] !== "Delivery") return null;
  if (row["Record class"] !== "Production") return null;
  if (!row.Item || !row["Occurred at"] || !row.Unit || row["Quantity delta"] === null) return null;

  return {
    eventId: record.eventId,
    recordClass: row["Record class"],
    eventType: "ITEM_STOCK_DELTA",
    itemKey: row.Item,
    occurredAt: row["Occurred at"],
    payload: {
      quantity: row["Quantity delta"],
      unit: row.Unit,
      note: row.Evidence,
      evidencePrecision: "EXACT",
    },
    supersedes: row["Supersedes event ID"],
  };
}

/**
 * Compose canonical delivery-evidence records into the existing deterministic
 * State Engine replay. This is pure and deliberately performs no persistence,
 * approval, dispatch, or Production mutation.
 */
export function replayCanonicalDeliveryEvidence(
  existingEvents: readonly HouseholdEvent[],
  evidenceRecords: readonly CanonicalAppendRecord[],
  options?: Parameters<typeof replayEvents>[1],
): DeliveryEvidenceReplayResult {
  const seen = new Set<string>();
  const replayInput: HouseholdEvent[] = [];

  for (const event of existingEvents) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    replayInput.push(event);
  }

  for (const record of evidenceRecords) {
    const event = toReplayEvent(record);
    if (!event) {
      return {
        ok: false,
        code: "INVALID_CANONICAL_RECORD",
        detail: `Canonical delivery record ${record.eventId} is not replayable: Delivery, Production, item, occurred-at, unit and quantity are required.`,
      };
    }
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    replayInput.push(event);
  }

  return {
    ok: true,
    events: replayInput,
    snapshot: replayEvents(replayInput, options),
  };
}
