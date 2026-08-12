import type { HouseholdEvent } from "../state-engine/types";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { QuantityRequirementsHandoff, StateSnapshot } from "../state-engine/types";
import type {
  ConsumptionDecision,
  ConsumptionException,
  ConsumptionPlan,
  ConsumptionProjection,
  DailyAllocation,
  PlannedComponent,
  PlannedMeal,

  ProjectOptions,
} from "./types";

/** Deterministic event id — the same plan always projects the same ids. */
function mealEventId(mealId: string, itemKey: string): string {
  return `CONSUME:${mealId}:${itemKey}`;
}

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
 * Guarantees:
 * - only completed / past-due meals burn (skipped & changed never do);
 * - event ids are derived from plan identity, so replaying or re-delivering a
 *   completion cannot double-decrement (the State Engine applies each id once);
 * - no leftovers are inventoried unless explicitly planned;
 * - durable stock is never burned without a plan or exception demanding it.
 */
export function projectConsumptionEvents(
  plan: ConsumptionPlan,
  options: ProjectOptions,
): ConsumptionProjection {
  const events: HouseholdEvent[] = [];
  const decisions: ConsumptionDecision[] = [];
  const uncertain = new Set<string>();

  const exceptions = plan.exceptions ?? [];
  const overrides = new Map<string, ConsumptionException>();
  for (const x of exceptions) {
    if ((x.type === "NOT_CONSUMED" || x.type === "PARTIAL_CONSUMPTION") && x.mealId) {
      overrides.set(`${x.mealId}::${x.itemKey}`, x);
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

    // Components are aggregated per (itemKey, unit) BEFORE emitting: two recipe
    // lines naming the same item would otherwise collide on the derived event
    // id and be seen by the State Engine as a reused-ID payload conflict.
    const aggregated = new Map<string, PlannedComponent>();
    for (const c of meal.components) {
      const key = `${c.itemKey}::${c.unit}`;
      const existing = aggregated.get(key);
      if (existing) existing.quantity += c.quantity;
      else aggregated.set(key, { ...c });
    }

    for (const c of aggregated.values()) {
      const override = overrides.get(`${meal.mealId}::${c.itemKey}`);
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

      events.push({
        eventId: mealEventId(meal.mealId, c.itemKey),
        recordClass: "Production",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: c.itemKey,
        occurredAt: meal.plannedFor,
        payload: {
          quantity: -quantity,
          unit: override?.unit ?? c.unit,
          note: override ? `partial via ${override.exceptionId}` : `planned meal ${meal.mealId}`,
        },
      });
      decisions.push({
        code: override ? "MEAL_OVERRIDDEN_BY_EXCEPTION" : "MEAL_ASSUMED_CONSUMED",
        sourceId: override?.exceptionId ?? meal.mealId,
        itemKey: c.itemKey,
        detail: `Burned ${quantity}${c.unit} at planned household quantity.`,
      });
    }

    for (const l of meal.plannedLeftovers ?? []) {
      events.push({
        eventId: `LEFTOVER:${meal.mealId}:${l.itemKey}`,
        recordClass: "Production",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: l.itemKey,
        occurredAt: meal.plannedFor,
        payload: { quantity: l.quantity, unit: l.unit, note: "planned leftover" },
      });
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
      events.push({
        eventId: `ALLOC:${a.allocationId}:${date}`,
        recordClass: "Production",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: a.itemKey,
        occurredAt: `${date}T23:59:59.000Z`,
        payload: { quantity: -quantity, unit: a.unit, note: `allocation ${a.allocationId}` },
      });
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
    events.push({
      eventId: `EXC:${x.exceptionId}`,
      recordClass: "Production",
      eventType: "ITEM_STOCK_DELTA",
      itemKey: x.itemKey,
      occurredAt: x.occurredAt,
      payload: {
        quantity: -quantity,
        ...(x.unit === undefined ? {} : { unit: x.unit }),
        note: x.note ?? "unplanned consumption exception",
      },
    });
    decisions.push({
      code: "UNPLANNED_CONSUMPTION_APPLIED",
      sourceId: x.exceptionId,
      itemKey: x.itemKey,
      detail: "Reported as an exception event; no manual inventory edit required.",
    });
  }

  return { events, uncertainItemKeys: [...uncertain].sort(), decisions };
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
