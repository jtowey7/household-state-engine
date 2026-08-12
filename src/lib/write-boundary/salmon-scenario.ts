/**
 * Salmon scenario — the real household case, run end to end as a SYNTHETIC
 * fixture through the append boundary and back through the State Engine.
 *
 * Nothing here touches Airtable. The opening delivery is an operator-declared
 * row in the real field contract; the consumption event is *drafted by the
 * write boundary* rather than hand-written, so the same code path future
 * planned-meal automation will use is the one under test.
 */

import { mapHouseholdEventRows } from "../production-adapter/airtable-port";
import type { AirtableRow } from "../production-adapter/airtable-port";
import { replayEvents } from "../state-engine/engine";
import type { StateSnapshot } from "../state-engine/types";
import { createAppendOnlyWriteBoundary } from "./boundary";
import type { AppendOnlyWriteBoundary } from "./boundary";
import type { AppendIntent, HouseholdEventRowDraft } from "./types";

export const SALMON_ITEM = "Tesco 6 Boneless Salmon Fillets 780G";

export const salmonOpeningRow: AirtableRow = {
  id: "recSALMONOPEN",
  fields: {
    "Event ID": "EVT-2026-08-11-SALMON-DELIVERY",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T08:30:00.000Z",
    "Recorded at": "2026-08-11T08:35:00.000Z",
    Source: "Tesco delivery",
    Actor: "James",
    "Entity type": "Inventory item",
    "Entity reference": "INV-SALMON-780G",
    Item: SALMON_ITEM,
    "Quantity delta": 780,
    Unit: "g",
    Evidence: "Tesco delivery note 11 Aug 2026",
    "State before": "0",
    "State after": "780",
    Confidence: "High",
    "Replay status": "Applied",
    "Record class": "Production",
  },
};

/** Planned Tuesday meal completion => automatic expected consumption. */
export const plannedSalmonConsumption: AppendIntent = {
  eventType: "Consumption",
  item: SALMON_ITEM,
  occurredAt: "2026-08-11T18:30:00.000Z",
  quantityDelta: -780,
  unit: "g",
  source: "Planned meal completion",
  actor: "Food OS state engine",
  entityType: "Inventory item",
  entityReference: "INV-SALMON-780G",
  evidence: "meal:2026-08-11-dinner (planned meal marked complete)",
  confidence: "High",
  stateBefore: 780,
  recordClass: "Production",
};

/** Operator correction restating the absolute on-hand state instead. */
export const salmonCorrection: AppendIntent = {
  eventType: "Correction",
  item: SALMON_ITEM,
  occurredAt: "2026-08-12T07:00:00.000Z",
  stateAfter: 0,
  stateBefore: 780,
  unit: "g",
  source: "Household correction",
  actor: "James",
  evidence: "Fridge check 12 Aug 2026 — salmon eaten Tuesday",
  exceptionAction: "Reconciled against planned meal",
  recordClass: "Production",
};

export interface SalmonScenarioResult {
  boundary: AppendOnlyWriteBoundary;
  /** The exact rows that WOULD be appended (nothing was written). */
  draftedRows: HouseholdEventRowDraft[];
  snapshot: StateSnapshot;
  onHand: number;
  unit: string | null;
  blocked: boolean;
}

function toAirtableRow(row: HouseholdEventRowDraft, index: number): AirtableRow {
  // A drafted row has no Airtable record id yet; a synthetic placeholder is
  // used so the mapper's "record id is never the Event ID" guard still holds.
  return { id: `recDRAFT${index}`, fields: { ...row } };
}

/**
 * Runs: opening delivery -> drafted consumption/correction -> replay.
 * `deliveries` lets a caller deliver the same intent more than once to prove
 * idempotency at the boundary and in the replay.
 */
export async function runSalmonScenario(options: {
  intents: AppendIntent[];
  now?: () => string;
  openingRows?: AirtableRow[];
}): Promise<SalmonScenarioResult> {
  const now = options.now ?? (() => "2026-08-12T08:00:00.000Z");
  const boundary = createAppendOnlyWriteBoundary({ now });
  const draftedRows: HouseholdEventRowDraft[] = [];

  for (const intent of options.intents) {
    const result = await boundary.append(intent);
    if (result.preview && result.outcome === "SIMULATED") {
      draftedRows.push(result.preview.row);
    }
  }

  const rows = [
    ...(options.openingRows ?? [salmonOpeningRow]),
    ...draftedRows.map(toAirtableRow),
  ];
  const batch = mapHouseholdEventRows(rows);
  const snapshot = replayEvents(batch.events, { now });
  const item = snapshot.items.find((i) => i.itemKey === SALMON_ITEM);

  return {
    boundary,
    draftedRows,
    snapshot,
    onHand: item?.quantity ?? 0,
    unit: item?.unit ?? null,
    blocked: item?.blocked ?? false,
  };
}
