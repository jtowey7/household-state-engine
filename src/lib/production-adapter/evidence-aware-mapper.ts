import { classifyEvidencePrecision } from "../state-engine/evidence-precision";
import type { HouseholdEvent } from "../state-engine/types";
import {
  mapHouseholdEventRow,
  type AirtableRow,
  type EventRowMapping,
} from "./airtable-port";

/**
 * Adapter boundary that preserves source-evidence qualification for the
 * hardened State Engine.
 *
 * The base mapper remains responsible for strict schema/state mapping. This
 * wrapper adds only the evidence precision already present in the real
 * `Evidence` field; it never changes the numeric quantity or invents evidence.
 */
export function mapHouseholdEventRowWithEvidencePrecision(
  row: AirtableRow,
): EventRowMapping {
  const mapped = mapHouseholdEventRow(row);
  if (!mapped.ok) return mapped;

  const evidencePrecision = classifyEvidencePrecision(mapped.provenance.evidence);
  const event: HouseholdEvent = {
    ...mapped.event,
    payload: {
      ...mapped.event.payload,
      evidencePrecision,
    },
  };

  return { ...mapped, event };
}

export function mapHouseholdEventRowsWithEvidencePrecision(rows: AirtableRow[]) {
  return rows.map(mapHouseholdEventRowWithEvidencePrecision);
}
