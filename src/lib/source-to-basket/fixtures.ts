/**
 * SYNTHETIC Airtable-shaped fixtures for the source → basket vertical slice.
 * Real HOUSEHOLD EVENTS field names, entirely invented rows. No production data.
 */
import type { AirtableRow } from "../production-adapter/airtable-port";
import type { SourceScope } from "../production-adapter/types";
import type { DemandTarget } from "../quantity-adapter/types";

export const sliceScope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "synthetic-source-to-basket",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

export const sliceProvenance = "synthetic fixture — source-to-basket test lab";
export const sliceNow = () => "2026-08-08T00:00:00.000Z";

export function eventRow(
  recordId: string,
  fields: Record<string, unknown>,
): AirtableRow {
  return {
    id: recordId,
    fields: {
      "Recorded at": "2026-08-01T06:02:00.000Z",
      Source: "synthetic fixture",
      Actor: "test-lab",
      "Entity type": "Inventory item",
      "Entity reference": "SYN-0001",
      Evidence: "synthetic-evidence",
      Confidence: "High",
      "Supersedes event ID": "",
      "Exception / reconciliation action": "",
      "Replay status": "Applied",
      "Record class": "Production",
      ...fields,
    },
  };
}

/** Opening receipts + a consumption burn-down, in the real field contract. */
export const sliceRows: AirtableRow[] = [
  eventRow("recSYN1", {
    "Event ID": "SYN-EVT-1",
    "Event type": "Receipt",
    "Occurred at": "2026-08-01T06:00:00.000Z",
    Item: "oats-rolled",
    "Quantity delta": 1000,
    Unit: "g",
  }),
  eventRow("recSYN2", {
    "Event ID": "SYN-EVT-2",
    "Event type": "Consumption",
    "Occurred at": "2026-08-02T08:00:00.000Z",
    Item: "oats-rolled",
    "Quantity delta": 400,
    Unit: "g",
  }),
  eventRow("recSYN3", {
    "Event ID": "SYN-EVT-3",
    "Event type": "Receipt",
    "Occurred at": "2026-08-01T06:00:00.000Z",
    Item: "milk-whole",
    "Quantity delta": 4,
    Unit: "L",
  }),
];

/** Planning-supplied demand targets — never inferred from events/INVENTORY. */
export const sliceTargets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" },
  { itemKey: "eggs-large", targetQuantity: 12, unit: "count", packSize: 6, packUnit: "count" },
];
