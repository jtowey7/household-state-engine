/**
 * Food OS — SHADOW household case (operator-declared input, NOT a live read).
 *
 * There is still no Airtable connector available to this project, so nothing
 * in this file is read from the real base. Every row below is an
 * operator-declared restatement of facts James gave in chat, shaped in the
 * EXACT real HOUSEHOLD EVENTS field contract so the same rows can be replaced
 * one-for-one by a read-only connector later.
 *
 * Boundary rules honoured here:
 * - the scope is SYNTHETIC and the provenance is explicitly marked as a
 *   fixture, so the production-state guard refuses to let it masquerade as
 *   production state;
 * - nothing is written back: the port has no write member and the cycle is
 *   shadow-only (no dispatch, no inventory edit);
 * - the Tuesday salmon is represented as EVENTS (planned-meal consumption,
 *   an exception, or an Airtable Correction) — never as a manual stock edit.
 */

import type { AirtableRow } from "../production-adapter/airtable-port";
import type { SourceScope } from "../production-adapter/types";
import type { ConsumptionPlan } from "../consumption/types";
import type { DemandTarget } from "../quantity-adapter/types";

export const SALMON = "Tesco 6 Boneless Salmon Fillets 780G";
export const ICE_CREAM = "Individual Ice Cream";
export const BUTTER = "Kerrygold Butter 250G";
export const BANANAS = "Loose Bananas";

export const shadowProvenance =
  "operator-declared shadow fixture — restated in chat, NOT a live Airtable read";

export const shadowScope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "shadow-household-declared",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-12",
};

/** Evaluation instant for the shadow cycle (Wednesday morning). */
export const shadowAsOf = "2026-08-12T08:00:00.000Z";
export const shadowNow = () => "2026-08-12T08:00:00.000Z";

function row(id: string, fields: Record<string, unknown>): AirtableRow {
  return { id, fields };
}

/** Opening household state, in the real HOUSEHOLD EVENTS schema. */
export const declaredEventRows: AirtableRow[] = [
  row("recSALMON001", {
    "Event ID": "EVT-2026-08-11-SALMON-DELIVERY",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T08:30:00.000Z",
    "Recorded at": "2026-08-11T08:35:00.000Z",
    Source: "Tesco delivery",
    Actor: "James",
    "Entity type": "Inventory item",
    "Entity reference": "INV-SALMON-780G",
    Item: SALMON,
    "Quantity delta": 780,
    Unit: "g",
    Evidence: "Tesco delivery note 11 Aug 2026",
    Confidence: "High",
    "Replay status": "Applied",
    "Record class": "Production",
  }),
  row("recICE001", {
    "Event ID": "EVT-2026-08-10-ICECREAM-DELIVERY",
    "Event type": "Delivery",
    "Occurred at": "2026-08-10T09:00:00.000Z",
    Source: "Tesco delivery",
    "Entity type": "Inventory item",
    Item: ICE_CREAM,
    "Quantity delta": 12,
    Unit: "unit",
    Evidence: "Tesco delivery note 10 Aug 2026",
    "Record class": "Production",
  }),
  row("recBUTTER001", {
    "Event ID": "EVT-2026-08-10-BUTTER-DELIVERY",
    "Event type": "Delivery",
    "Occurred at": "2026-08-10T09:00:00.000Z",
    Source: "Tesco delivery",
    Item: BUTTER,
    "Quantity delta": 250,
    Unit: "g",
    "Record class": "Production",
  }),
  row("recBANANA001", {
    "Event ID": "EVT-2026-08-10-BANANAS-DELIVERY",
    "Event type": "Delivery",
    "Occurred at": "2026-08-10T09:00:00.000Z",
    Source: "Tesco delivery",
    Item: BANANAS,
    "Quantity delta": 6,
    Unit: "unit",
    "Record class": "Production",
  }),
  // Real, valid, but not a deterministic stock change: preserved as a source
  // record only. It must never silently move stock.
  row("recCONF001", {
    "Event ID": "EVT-2026-08-11-SALMON-CONFIRMATION",
    "Event type": "Confirmation",
    "Occurred at": "2026-08-11T09:00:00.000Z",
    Item: SALMON,
    Evidence: "Photo of fridge shelf",
    "Record class": "Production",
  }),
  // Test-class row: must have zero effect on shadow state.
  row("recTEST001", {
    "Event ID": "EVT-TEST-SALMON-NOISE",
    "Event type": "Consumption",
    "Occurred at": "2026-08-11T10:00:00.000Z",
    Item: SALMON,
    "Quantity delta": -780,
    Unit: "g",
    "Record class": "Test",
  }),
];

/**
 * Representation A — the agreed general rule: a COMPLETED planned meal
 * automatically generates expected consumption. The Tuesday salmon dinner
 * consumed the whole 780 g pack; portion-level tracking is not required and no
 * leftovers are invented.
 */
export const declaredPlan: Omit<ConsumptionPlan, "openingEvents"> = {
  meals: [
    {
      mealId: "MEAL-2026-08-11-DINNER",
      plannedFor: "2026-08-11T18:30:00.000Z",
      state: "COMPLETED",
      components: [{ itemKey: SALMON, quantity: 780, unit: "g" }],
    },
  ],
  allocations: [
    {
      allocationId: "ALLOC-ICECREAM-DAILY",
      itemKey: ICE_CREAM,
      quantityPerPersonPerDay: 1,
      unit: "unit",
      people: 2,
      startDate: "2026-08-11",
      endDate: "2026-08-12",
    },
  ],
  exceptions: [
    {
      exceptionId: "EXC-2026-08-11-BUTTER",
      type: "UNPLANNED_CONSUMPTION",
      itemKey: BUTTER,
      quantity: 50,
      unit: "g",
      occurredAt: "2026-08-11T20:00:00.000Z",
      note: "Butter used outside any plan; reported as an exception, not an inventory edit.",
    },
    {
      exceptionId: "EXC-2026-08-11-BANANAS",
      type: "UNCERTAIN_QUANTITY",
      itemKey: BANANAS,
      occurredAt: "2026-08-11T20:00:00.000Z",
      note: "Unknown how many are left; isolate this item only.",
    },
  ],
};

/**
 * Representation B — the same Tuesday salmon expressed as an explicit
 * unplanned-consumption exception instead of a planned meal. Shadow state must
 * still land on 0 g.
 */
export const exceptionOnlyPlan: Omit<ConsumptionPlan, "openingEvents"> = {
  exceptions: [
    {
      exceptionId: "EXC-2026-08-11-SALMON-EATEN",
      type: "UNPLANNED_CONSUMPTION",
      itemKey: SALMON,
      quantity: 780,
      unit: "g",
      occurredAt: "2026-08-11T18:30:00.000Z",
      note: "Eaten Tuesday; recorded as a consumption exception.",
    },
  ],
};

/**
 * Representation C — the same fact as an Airtable `Correction` row carrying a
 * numeric `State after` of 0 g. Appended to the declared rows; the correction
 * supersedes nothing and mutates no existing record.
 */
export const salmonCorrectionRow: AirtableRow = row("recCORR001", {
  "Event ID": "EVT-2026-08-11-SALMON-CORRECTION",
  "Event type": "Correction",
  "Occurred at": "2026-08-11T21:00:00.000Z",
  Item: SALMON,
  "State before": "780",
  "State after": 0,
  Unit: "g",
  Evidence: "Household reported the pack was eaten on Tuesday",
  "Exception / reconciliation action": "Corrected to zero on hand",
  "Record class": "Production",
});

/** Weekly planning supplies demand targets — the event source never does. */
export const shadowTargets: DemandTarget[] = [
  { itemKey: SALMON, targetQuantity: 780, unit: "g", packSize: 780, packUnit: "g" },
  { itemKey: ICE_CREAM, targetQuantity: 12, unit: "unit", packSize: 4, packUnit: "unit" },
  { itemKey: BUTTER, targetQuantity: 250, unit: "g", packSize: 250, packUnit: "g" },
  { itemKey: BANANAS, targetQuantity: 6, unit: "unit", packSize: 6, packUnit: "unit" },
];
