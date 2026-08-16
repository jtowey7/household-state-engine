/**
 * SYNTHETIC Airtable-shaped fixtures for the adapter → replay → QUANTITY
 * REQUIREMENTS safety-boundary proof.
 *
 * Real HOUSEHOLD EVENTS field names, entirely invented rows. Read-only,
 * never connected to Airtable or to real household production state.
 */
import type { AirtableRow } from "../production-adapter/airtable-port";
import type { DemandTarget } from "../quantity-adapter/types";

export const safetyProofNow = () => "2026-08-08T00:00:00.000Z";

function row(recordId: string, fields: Record<string, unknown>): AirtableRow {
  return {
    id: recordId,
    fields: {
      "Recorded at": "2026-08-01T06:02:00.000Z",
      Source: "synthetic fixture",
      Actor: "safety-proof",
      "Entity type": "Inventory item",
      "Entity reference": "SYN-PROOF",
      Evidence: "photographed receipt",
      Confidence: "High",
      "Supersedes event ID": "",
      "Exception / reconciliation action": "",
      "Replay status": "Applied",
      "Record class": "Production",
      ...fields,
    },
  };
}

/**
 * Representative stream:
 *  - oats-rolled: exact Production receipt + consumption (stays eligible)
 *  - milk-whole: Production receipt with QUALIFIED evidence (item-only block)
 *  - oats-rolled: a Record class = Test row that must have zero effect
 *  - eggs-large: absent from state entirely (demand universe still covers it)
 */
export const safetyProofRows: AirtableRow[] = [
  row("recPROOF1", {
    "Event ID": "PROOF-EVT-1",
    "Event type": "Receipt",
    "Occurred at": "2026-08-01T06:00:00.000Z",
    Item: "oats-rolled",
    "Quantity delta": 1000,
    Unit: "g",
  }),
  row("recPROOF2", {
    "Event ID": "PROOF-EVT-2",
    "Event type": "Consumption",
    "Occurred at": "2026-08-02T08:00:00.000Z",
    Item: "oats-rolled",
    "Quantity delta": 400,
    Unit: "g",
  }),
  row("recPROOF3", {
    "Event ID": "PROOF-EVT-3",
    "Event type": "Receipt",
    "Occurred at": "2026-08-02T09:00:00.000Z",
    Item: "milk-whole",
    "Quantity delta": 4,
    Unit: "L",
    Evidence: "approx 4 litres, carton partially used",
  }),
  row("recPROOF4", {
    "Event ID": "PROOF-EVT-TEST-1",
    "Event type": "Consumption",
    "Occurred at": "2026-08-03T08:00:00.000Z",
    Item: "oats-rolled",
    "Quantity delta": 600,
    Unit: "g",
    "Record class": "Test",
  }),
];

/** Planning-supplied demand targets — never inferred from events/INVENTORY. */
export const safetyProofTargets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" },
  { itemKey: "eggs-large", targetQuantity: 12, unit: "count", packSize: 6, packUnit: "count" },
];
