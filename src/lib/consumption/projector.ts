import type { HouseholdEvent } from "../state-engine/types";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { QuantityRequirementsHandoff, StateSnapshot } from "../state-engine/types";
import { createAppendOnlyWriteBoundary } from "../write-boundary/boundary";
import { proposeConsumptionAppend } from "./append-adapter";
import type { ConsumptionAppendProposal, ConsumptionAppendRequest } from "./append-adapter";
import type {
  ConsumptionDecision,
  ConsumptionException,
  ConsumptionPlan,
  ConsumptionProjection,
  PlannedComponent,
  PlannedMeal,
  ProjectOptions,
} from "./types";

function isMealDue(meal: PlannedMeal, asOf: string): boolean {
  if (meal.state === "COMPLETED") return true;
  if (meal.state === "DUE") return meal.plannedFor <= asOf;
  return false;
}

function eachDate(start: string, end: string, asOf: string): string[] {
  const out: string[] = [];
  const last = asOf.slice(0, 10) < end ? asOf.slice(0, 10) : end;
  let cursor = new Date(`${start}T00:00:00.000Z`).getTime();
  const stop = new Date(`${last}T00:00:00.000Z`).getTime();
  while (cursor <= stop) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

/**
 * Projects a synthetic meal plan into consumption events.
 *
 * Every event is synthesised in ONE place: the canonical append boundary
 * (`proposeConsumptionAppend`). This module no longer constructs
 * `ITEM_STOCK_DELTA` records itself, so the write contract, Event ID identity
 * and validation cannot drift between the consumption layer and the writer.
 *
 * Guarantees:
 * - only completed / past-due meals burn (skipped & changed never do);
 * - Event IDs derive from a stable identity context, so replaying or
 *   re-delivering a completion cannot double-decrement;
 * - no leftovers are inventoried unless explicitly planned;
 * - durable stock is never burned without a plan or exception demanding it;
 * - the boundary is PREPARE-only: results are PROPOSE_APPEND, never a write.
 */
export function projectConsumptionEvents(
  plan: ConsumptionPlan,
  options: ProjectOptions,
): ConsumptionProjection {
  const events: HouseholdEvent[] = [];
  const decisions: ConsumptionDecision[] = [];
  const appendProposals: ConsumptionAppendProposal[] = [];
  const uncertain = new Set<string>();

  const now = options.now ?? (() => "1970-01-01T00:00:00.000Z");
  const boundary = options.boundary ?? createAppendOnlyWriteBoundary({ now });
  const appendOptions = {
    now,
    boundary,
    ...(options.recordClass ? { recordClass: options.recordClass } : {}),
  };

  /** Single synthesis seam: intent -> boundary proposal -> replay event. */
  function emit(request: ConsumptionAppendRequest): boolean {
    const proposed = proposeConsumptionAppend(request, appendOptions);
    if (!proposed.ok) {
      decisions.push({
        code: "CONSUMPTION_APPEND_REFUSED",
        sourceId: request.sourceId,
        itemKey: request.itemKey,
        detail: `${proposed.code}: ${proposed.detail}`,
      });
      return false;
    }
    appendProposals.push(proposed.proposal);
    events.push(proposed.proposal.event);
    return true;
  }

  const exceptions = plan.exceptions ?? [];
  const overrides = new Map<string, ConsumptionException>();
  for (const x of exceptions) {
    if ((x.type === "NOT_CONSUMED" || x.type === "PARTIAL_CONSUMPTION") && x.mealId) {
      overrides.set(`${x.mealId}::${x.itemKey}::${x.unit ?? ""}`, x);
    }
    if (x.type === "UNCERTAIN_QUANTITY") {
      uncertain.add(x.itemKey);
      decisions.push({
        code: "ITEM_UNCERTAIN_ISOLATED",
        sourceId: x.exceptionId,
        itemKey: x.itemKey,
        detail: "Quantity uncertain; item isolated from downstream runs, provenance kept.",
      });
    }
  }

  for (const ev of plan.openingEvents ?? []) events.push(ev);

  for (const meal of plan.meals ?? []) {
    if (meal.state === "SKIPPED" || meal.state === "CHANGED") {
      decisions.push({
        code: meal.state === "SKIPPED" ? "MEAL_SKIPPED" : "MEAL_CHANGED",
        sourceId: meal.mealId,
        itemKey: null,
        detail: "Explicitly marked; no consumption assumed even though the date passed.",
      });
      continue;
    }
    if (!isMealDue(meal, options.asOf)) {
      decisions.push({
        code: "MEAL_NOT_DUE",
        sourceId: meal.mealId,
        itemKey: null,
        detail: "Not yet completion/due state; no consumption assumed.",
      });
      continue;
    }

    const aggregated = new Map<string, PlannedComponent>();
    for (const c of meal.components) {
      const key = `${c.itemKey}::${c.unit}`;
      const existing = aggregated.get(key);
      if (existing) existing.quantity += c.quantity;
      else aggregated.set(key, { ...c });
    }

    for (const c of aggregated.values()) {
      // Prefer a unit-specific exception. Preserve the legacy item-level
      // exception behaviour when an older exception has no unit.
      const override =
        overrides.get(`${meal.mealId}::${c.itemKey}::${c.unit}`) ??
        overrides.get(`${meal.mealId}::${c.itemKey}::`);
      if (override?.type === "NOT_CONSUMED") {
        decisions.push({
          code: "MEAL_OVERRIDDEN_BY_EXCEPTION",
          sourceId: override.exceptionId,
          itemKey: c.itemKey,
          detail: "Explicit exception: planned quantity was not consumed.",
        });
        continue;
      }
      const quantity =
        override?.type === "PARTIAL_CONSUMPTION" ? (override.quantity ?? 0) : c.quantity;
      if (quantity <= 0) continue;

      const emitted = emit({
        kind: "CONSUME",
        sourceId: meal.mealId,
        itemKey: c.itemKey,
        quantity,
        unit: c.unit,
        occurredAt: meal.plannedFor,
        direction: "OUT",
        evidence: override
          ? `partial via ${override.exceptionId}`
          : `planned meal ${meal.mealId}`,
      });
      if (!emitted) continue;

      decisions.push({
        code: override ? "MEAL_OVERRIDDEN_BY_EXCEPTION" : "MEAL_ASSUMED_CONSUMED",
        sourceId: override?.exceptionId ?? meal.mealId,
        itemKey: c.itemKey,
        detail: `Burned ${quantity}${c.unit} at planned household quantity.`,
      });
    }

    for (const l of meal.plannedLeftovers ?? []) {
      const emitted = emit({
        kind: "LEFTOVER",
        sourceId: meal.mealId,
        itemKey: l.itemKey,
        quantity: l.quantity,
        unit: l.unit,
        occurredAt: meal.plannedFor,
        direction: "IN",
        evidence: "planned leftover",
      });
      if (!emitted) continue;
      decisions.push({
        code: "PLANNED_LEFTOVER_RETURNED",
        sourceId: meal.mealId,
        itemKey: l.itemKey,
        detail: "Leftover inventoried because it was explicitly planned.",
      });
    }
  }

  for (const a of plan.allocations ?? []) {
    for (const date of eachDate(a.startDate, a.endDate, options.asOf)) {
      const quantity = a.quantityPerPersonPerDay * a.people;
      if (quantity <= 0) continue;
      const emitted = emit({
        kind: "ALLOC",
        sourceId: `${a.allocationId}:${date}`,
        itemKey: a.itemKey,
        quantity,
        unit: a.unit,
        occurredAt: `${date}T23:59:59.000Z`,
        direction: "OUT",
        evidence: `allocation ${a.allocationId}`,
      });
      if (!emitted) continue;
      decisions.push({
        code: "ALLOCATION_BURNED",
        sourceId: a.allocationId,
        itemKey: a.itemKey,
        detail: `${date}: ${a.quantityPerPersonPerDay} × ${a.people} people = ${quantity}${a.unit}.`,
      });
    }
  }

  for (const x of exceptions) {
    if (x.type !== "UNPLANNED_CONSUMPTION") continue;
    const quantity = x.quantity ?? 0;
    if (quantity <= 0) continue;
    const emitted = emit({
      kind: "EXC",
      sourceId: x.exceptionId,
      itemKey: x.itemKey,
      quantity,
      unit: x.unit ?? "",
      occurredAt: x.occurredAt,
      direction: "OUT",
      evidence: x.note ?? "unplanned consumption exception",
    });
    if (!emitted) continue;
    decisions.push({
      code: "UNPLANNED_CONSUMPTION_APPLIED",
      sourceId: x.exceptionId,
      itemKey: x.itemKey,
      detail: "Reported as an exception event; no manual inventory edit required.",
    });
  }

  return {
    events,
    uncertainItemKeys: [...uncertain].sort(),
    decisions,
    appendProposals,
  };
}

export interface ConsumptionCycle {
  projection: ConsumptionProjection;
  snapshot: StateSnapshot;
  /** Uncertain items are withheld from the handoff but stay visible/provenanced. */
  handoff: QuantityRequirementsHandoff;
}

/** Projects, replays and hands off in one deterministic pass. */
export function runConsumptionCycle(
  plan: ConsumptionPlan,
  options: ProjectOptions & { now?: () => string },
): ConsumptionCycle {
  const projection = projectConsumptionEvents(plan, options);
  const snapshot = replayEvents(projection.events, options.now ? { now: options.now } : {});
  const base = toQuantityRequirementsHandoff(snapshot);
  const uncertain = new Set(projection.uncertainItemKeys);
  const handoff: QuantityRequirementsHandoff = {
    ...base,
    items: base.items.filter((i) => !uncertain.has(i.itemKey)),
    blockedItemKeys: [...new Set([...base.blockedItemKeys, ...uncertain])].sort(),
  };
  return { projection, snapshot, handoff };
}
