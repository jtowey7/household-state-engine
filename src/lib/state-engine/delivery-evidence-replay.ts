import { replayEvents } from "./engine";
import type { CanonicalAppendRecord } from "../event-writer/types";
import type { HouseholdEvent, StateSnapshot } from "./types";

export type DeliveryEvidenceReplayResult =
  | { ok: true; events: HouseholdEvent[]; snapshot: StateSnapshot }
  | { ok: false; code: "INVALID_CANONICAL_RECORD" | "EVENT_ID_COLLISION"; detail: string };

function toReplayEvent(record: CanonicalAppendRecord): HouseholdEvent | null {
  const row = record.row;
  if (row["Event type"] !== "Delivery") return null;
  if (row["Record class"] !== "Production") return null;
  if (!row.Item || !row["Occurred at"] || !row.Unit || row["Quantity delta"] === null) return null;
  if (typeof row["Quantity delta"] !== "number" || row["Quantity delta"] <= 0) return null;

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

function sameReplayEvent(left: HouseholdEvent, right: HouseholdEvent): boolean {
  return (
    left.eventId === right.eventId &&
    left.recordClass === right.recordClass &&
    left.eventType === right.eventType &&
    left.itemKey === right.itemKey &&
    left.occurredAt === right.occurredAt &&
    left.payload.quantity === right.payload.quantity &&
    left.payload.unit === right.payload.unit &&
    left.payload.evidencePrecision === right.payload.evidencePrecision &&
    JSON.stringify(left.supersedes ?? []) === JSON.stringify(right.supersedes ?? [])
  );
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
  const seen = new Map<string, HouseholdEvent>();
  const replayInput: HouseholdEvent[] = [];

  for (const event of existingEvents) {
    const prior = seen.get(event.eventId);
    if (prior && !sameReplayEvent(prior, event)) {
      return {
        ok: false,
        code: "EVENT_ID_COLLISION",
        detail: `Existing replay stream contains conflicting payloads for Event ID ${event.eventId}; replay refused before materialisation.`,
      };
    }
    if (prior) continue;
    seen.set(event.eventId, event);
    replayInput.push(event);
  }

  for (const record of evidenceRecords) {
    const event = toReplayEvent(record);
    if (!event) {
      return {
        ok: false,
        code: "INVALID_CANONICAL_RECORD",
        detail: `Canonical delivery record ${record.eventId} is not replayable: Delivery, Production, item, occurred-at, unit and a positive quantity are required.`,
      };
    }
    const prior = seen.get(event.eventId);
    if (prior) {
      if (!sameReplayEvent(prior, event)) {
        return {
          ok: false,
          code: "EVENT_ID_COLLISION",
          detail: `Delivery evidence Event ID ${event.eventId} conflicts with an existing replay event; duplicate identity cannot be used to hide different payload state.`,
        };
      }
      continue;
    }
    seen.set(event.eventId, event);
    replayInput.push(event);
  }

  return {
    ok: true,
    events: replayInput,
    snapshot: replayEvents(replayInput, options),
  };
}
