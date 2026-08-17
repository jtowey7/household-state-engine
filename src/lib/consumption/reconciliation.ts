import { reconcileExpectedWithConfirmed } from "../expected-state";
import type {
  ConsumptionEvidence,
  ExpectedConsumption,
  ReconcileOptions,
  ReconciliationRun,
} from "../expected-state";
import type { ConsumptionPlan, DailyAllocation, PlannedMeal } from "./types";

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

function mealExpectations(meal: PlannedMeal): ExpectedConsumption[] {
  const aggregated = new Map<string, { itemKey: string; quantity: number; unit: string }>();
  for (const component of meal.components) {
    const key = `${component.itemKey}::${component.unit}`;
    const current = aggregated.get(key);
    if (current) current.quantity += component.quantity;
    else aggregated.set(key, { ...component });
  }

  const unitsByItem = new Map<string, Set<string>>();
  for (const component of aggregated.values()) {
    const units = unitsByItem.get(component.itemKey) ?? new Set<string>();
    units.add(component.unit);
    unitsByItem.set(component.itemKey, units);
  }

  return [...aggregated.values()].map((component) => {
    const multipleUnits = (unitsByItem.get(component.itemKey)?.size ?? 0) > 1;
    const identity = multipleUnits
      ? `EXPECTED:${meal.mealId}:${component.itemKey}:${component.unit}`
      : `EXPECTED:${meal.mealId}:${component.itemKey}`;

    return {
      expectationId: identity,
      itemKey: component.itemKey,
      quantity: component.quantity,
      unit: component.unit,
      expectedAt: meal.plannedFor,
      sourceId: meal.mealId,
      recordClass: "Production",
    };
  });
}

function allocationExpectations(allocation: DailyAllocation, asOf: string): ExpectedConsumption[] {
  return eachDate(allocation.startDate, allocation.endDate, asOf).map((date) => ({
    expectationId: `EXPECTED:${allocation.allocationId}:${date}`,
    itemKey: allocation.itemKey,
    quantity: allocation.quantityPerPersonPerDay * allocation.people,
    unit: allocation.unit,
    expectedAt: `${date}T23:59:59.000Z`,
    sourceId: allocation.allocationId,
    recordClass: "Production",
  }));
}

/**
 * Converts the household consumption plan into explicit expectations and then
 * reconciles those expectations with observed household evidence.
 *
 * This is the integration boundary between the planned-meal consumption model
 * and the EXPECTED-vs-CONFIRMED state model. It remains pure and read-only:
 * callers receive a confirmed-state handoff but no household state is written.
 */
export function reconcileConsumptionPlan(
  plan: ConsumptionPlan,
  evidence: readonly ConsumptionEvidence[],
  options: ReconcileOptions,
): ReconciliationRun {
  const expectations = [
    ...(plan.meals ?? [])
      .filter((meal) => isMealDue(meal, options.asOf))
      .flatMap(mealExpectations),
    ...(plan.allocations ?? []).flatMap((allocation) =>
      allocationExpectations(allocation, options.asOf),
    ),
  ];

  return reconcileExpectedWithConfirmed(
    {
      openingEvents: plan.openingEvents,
      expectations,
      evidence,
    },
    options,
  );
}
