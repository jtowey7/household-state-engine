import { replayEvents } from "./engine";
import type { CanonicalAppendRecord } from "../event-writer/types";
import type { HouseholdEvent, StateSnapshot } from "./types";

/**
 * Compose already-validated delivery-evidence events with the existing
 * replay stream. This is deliberately pure: it performs no persistence,
 * approval, dispatch, or Production mutation.
 *
 * Event IDs are deduplicated across the existing stream and evidence records
 * so the same delivery cannot be counted twice when it arrives through both
 * reconciled-delivery and sealed-evidence paths.
 */
export function replayWithDeliveryEvidence(
  events: readonly HouseholdEvent[],
  evidenceRecords: readonly CanonicalAppendRecord[],
  options?: Parameters<typeof replayEvents>[1],
): StateSnapshot {
  const seen = new Set<string>();
  const replayInput: HouseholdEvent[] = [];

  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    replayInput.push(event);
  }

  for (const record of evidenceRecords) {
    const event = record.event;
    if (!event || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    replayInput.push(event);
  }

  return replayEvents(replayInput, options);
}
