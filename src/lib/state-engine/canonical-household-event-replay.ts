/**
 * Food OS — canonical HOUSEHOLD EVENTS -> State Engine replay seam.
 *
 * This adapter consumes only an already-canonical append record. It performs no
 * Airtable I/O and does not authorise or execute writes. Its sole responsibility
 * is to turn the durable HOUSEHOLD EVENTS row shape back into the State Engine's
 * typed HouseholdEvent so the same canonical event can drive deterministic
 * inventory replay.
 */

import type { HouseholdEvent } from "./types";
import type { CanonicalAppendRecord } from "../event-writer/types";

export type CanonicalHouseholdEventReplayResult =
  | { ok: true; event: HouseholdEvent }
  | { ok: false; code: "INVALID_CANONICAL_RECORD"; detail: string };

export function canonicalRecordToHouseholdEvent(
  record: CanonicalAppendRecord,
): CanonicalHouseholdEventReplayResult {
  if (record.__canonical !== "HOUSEHOLD_EVENTS") {
    return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: "Record is not canonical HOUSEHOLD_EVENTS data." };
  }

  const row = record.row;
  if (row["Event ID"] !== record.eventId) {
    return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: "Canonical Event ID does not match the append record identity." };
  }

  if (!row.Item?.trim() || !row["Occurred at"]?.trim() || !row["Unit"]?.trim()) {
    return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: "Canonical HOUSEHOLD EVENTS row lacks item, occurrence time, or unit." };
  }

  const note = row.Evidence?.trim();
  const supersedes = [...(row["Supersedes event ID"] ?? [])];

  if (row["Event type"] === "Correction") {
    const stateAfter = Number(row["State after"]);
    if (!Number.isFinite(stateAfter) || stateAfter < 0) {
      return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: "Correction requires a non-negative numeric State after value." };
    }
    return {
      ok: true,
      event: {
        eventId: record.eventId,
        recordClass: row["Record class"],
        eventType: "ITEM_STOCK_SET",
        itemKey: row.Item,
        occurredAt: row["Occurred at"],
        payload: {
          quantity: stateAfter,
          unit: row.Unit,
          ...(note ? { note } : {}),
          evidencePrecision: "EXACT",
        },
        ...(supersedes.length > 0 ? { supersedes } : {}),
      },
    };
  }

  const deltaTypes = new Set(["Receipt", "Consumption", "Delivery", "Disposal"]);
  if (!deltaTypes.has(row["Event type"])) {
    return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: `Event type ${row["Event type"]} has no State Engine inventory mapping.` };
  }

  const quantityDelta = row["Quantity delta"];
  if (typeof quantityDelta !== "number" || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
    return { ok: false, code: "INVALID_CANONICAL_RECORD", detail: "Inventory delta event requires a finite non-zero Quantity delta." };
  }

  return {
    ok: true,
    event: {
      eventId: record.eventId,
      recordClass: row["Record class"],
      eventType: "ITEM_STOCK_DELTA",
      itemKey: row.Item,
      occurredAt: row["Occurred at"],
      payload: {
        quantity: quantityDelta,
        unit: row.Unit,
        ...(note ? { note } : {}),
        evidencePrecision: "EXACT",
      },
      ...(supersedes.length > 0 ? { supersedes } : {}),
    },
  };
}
