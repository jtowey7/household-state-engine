/**
 * Food OS — SHADOW household run.
 *
 * Takes declared household state through the full proven chain:
 *   Airtable-shaped rows -> read-only port -> consumption projection ->
 *   replay -> quantity requirements -> candidate basket -> approval gate.
 *
 * The output is isolated: nothing is written back to any household record and
 * no order is dispatched. When a read-only Airtable connector exists, only the
 * row source below changes.
 */

import {
  createAirtableProductionPort,
  createFakeAirtableRowSource,
  type AirtableRow,
} from "../production-adapter/airtable-port";
import { runWeeklyShadowCycle } from "../weekly-cycle/cycle";
import type { WeeklyCycleRun } from "../weekly-cycle/types";
import type { ConsumptionPlan } from "../consumption/types";
import { previewOfRecord, type PreparedAppend } from "../event-writer/preview";
import {
  declaredEventRows,
  declaredPlan,
  shadowAsOf,
  shadowNow,
  shadowProvenance,
  shadowScope,
  shadowTargets,
} from "./case";

export interface ShadowRunOptions {
  rows?: AirtableRow[];
  plan?: Omit<ConsumptionPlan, "openingEvents">;
  asOf?: string;
}

export async function runShadowHouseholdCycle(
  options: ShadowRunOptions = {},
): Promise<WeeklyCycleRun> {
  const source = createFakeAirtableRowSource({
    eventRows: options.rows ?? declaredEventRows,
    baseLabel: "food-os-declared-shadow",
    provenance: shadowProvenance,
  });
  const port = createAirtableProductionPort({
    source,
    // SYNTHETIC: declared input, explicitly not a live production read.
    mode: "SYNTHETIC",
    portId: "airtable-shape:declared-shadow",
  });

  return runWeeklyShadowCycle({
    port,
    scope: shadowScope,
    plan: options.plan ?? declaredPlan,
    asOf: options.asOf ?? shadowAsOf,
    now: shadowNow,
    demandTargets: shadowTargets,
  });
}

/** Materialised shadow quantity for one item, or null when not materialised. */
export function shadowQuantityFor(
  run: WeeklyCycleRun,
  itemKey: string,
): { quantity: number; unit: string | null; contributingEventIds: string[] } | null {
  const item = run.snapshot?.items.find((i) => i.itemKey === itemKey);
  if (!item) return null;
  return {
    quantity: item.quantity,
    unit: item.unit,
    contributingEventIds: item.contributingEventIds,
  };
}

/**
 * PROPOSED APPEND view of a shadow run: the exact HOUSEHOLD EVENTS rows that
 * WOULD be appended, each marked `wouldWrite: false`. The shadow cycle remains
 * non-writing and non-dispatching — no port is constructed here.
 */
export function shadowProposedAppends(run: WeeklyCycleRun): PreparedAppend[] {
  return run.appendProposals
    .filter((p): p is typeof p & { record: NonNullable<typeof p.record> } => p.record !== null)
    .map((p) => previewOfRecord(p.record));
}

/** Runs the shadow cycle and returns its preview-only append proposals. */
export async function runShadowHouseholdCycleWithProposals(
  options: ShadowRunOptions = {},
): Promise<{ run: WeeklyCycleRun; proposedAppend: PreparedAppend[] }> {
  const run = await runShadowHouseholdCycle(options);
  return { run, proposedAppend: shadowProposedAppends(run) };
}
