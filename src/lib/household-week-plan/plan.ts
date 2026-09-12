import type { QuantityRequirementsHandoff } from "../state-engine/types";
import type {
  HouseholdWeekPlan,
  PlannedWeekMeal,
  WeekMealComponentLine,
  WeekMealCoverage,
  WeekMealPlanLine,
  WeekPlanShortfall,
} from "./types";

const SEVERITY: Record<WeekMealCoverage, number> = {
  NOT_PLANNED: 0,
  COVERED: 1,
  SHORT: 2,
  NOT_COUNTED: 3,
  NEEDS_CHECK: 4,
};

const normalise = (itemKey: string) => itemKey.trim().toLowerCase();

const CONSUMING_STATES = new Set(["PLANNED", "DUE"]);

/**
 * Work out, deterministically, whether the meals still to be cooked this week
 * are covered by the household stock that has actually been counted.
 *
 * Stock is drawn down in planned order, so an ingredient shared by two meals
 * is never counted twice. Nothing here proposes, appends or buys anything.
 */
export function buildHouseholdWeekPlan(
  handoff: QuantityRequirementsHandoff,
  meals: readonly PlannedWeekMeal[],
): HouseholdWeekPlan {
  const base = {
    source: "HOUSEHOLD_STOCK_READOUT" as const,
    replayId: handoff.replayId,
    snapshotId: handoff.snapshotId,
    productionMutation: false as const,
  };

  const ordered = [...meals].sort((a, b) =>
    a.plannedFor === b.plannedFor
      ? a.mealId.localeCompare(b.mealId)
      : a.plannedFor.localeCompare(b.plannedFor),
  );

  if (!handoff.readyForQuantityRun) {
    return {
      ...base,
      readyForPlanning: false,
      blockedReason:
        "Some of what you counted needs a check first, so foodOS is not planning the week from it yet.",
      meals: ordered.map((meal) => ({
        mealId: meal.mealId,
        label: meal.label,
        plannedFor: meal.plannedFor,
        coverage: CONSUMING_STATES.has(meal.state)
          ? ("NEEDS_CHECK" as const)
          : ("NOT_PLANNED" as const),
        components: [],
        ...(meal.note ? { note: meal.note } : {}),
      })),
      shortfalls: [],
      notCountedItemKeys: [],
    };
  }

  const blocked = new Set(handoff.blockedItemKeys.map(normalise));
  const remaining = new Map<string, { quantity: number; unit: string | null }>();
  // Two counted rows whose keys differ only by case/whitespace are two distinct
  // household identities upstream. Keeping the last one silently discards the
  // other count, so fail closed and ask for a check instead of guessing.
  const ambiguousKeys = new Set<string>();
  for (const item of handoff.items) {
    const key = normalise(item.itemKey);
    if (remaining.has(key)) ambiguousKeys.add(key);
    remaining.set(key, { quantity: item.quantity, unit: item.unit });
  }

  const shortfalls = new Map<string, WeekPlanShortfall>();
  const notCounted = new Set<string>();
  const planned: WeekMealPlanLine[] = [];

  for (const meal of ordered) {
    if (!CONSUMING_STATES.has(meal.state)) {
      planned.push({
        mealId: meal.mealId,
        label: meal.label,
        plannedFor: meal.plannedFor,
        coverage: "NOT_PLANNED",
        components: [],
        ...(meal.note ? { note: meal.note } : {}),
      });
      continue;
    }

    const components: WeekMealComponentLine[] = meal.components.map((component) => {
      const key = normalise(component.itemKey);
      const stock = remaining.get(key);

      if (ambiguousKeys.has(key)) {
        return {
          itemKey: component.itemKey,
          needed: component.quantity,
          unit: component.unit,
          available: 0,
          shortfall: 0,
          coverage: "NEEDS_CHECK",
          because: "This is counted under more than one name, so foodOS will not guess which count to use.",
        };
      }

      if (blocked.has(key)) {
        return {
          itemKey: component.itemKey,
          needed: component.quantity,
          unit: component.unit,
          available: 0,
          shortfall: 0,
          coverage: "NEEDS_CHECK",
          because: "This one needs a check before it can be planned around.",
        };
      }

      if (!stock) {
        notCounted.add(component.itemKey);
        return {
          itemKey: component.itemKey,
          needed: component.quantity,
          unit: component.unit,
          available: 0,
          shortfall: component.quantity,
          coverage: "NOT_COUNTED",
          because: "You have not counted this yet, so foodOS will not assume you have it.",
        };
      }

      if (stock.unit !== component.unit) {
        return {
          itemKey: component.itemKey,
          needed: component.quantity,
          unit: component.unit,
          available: 0,
          shortfall: 0,
          coverage: "NEEDS_CHECK",
          because: `Counted in ${stock.unit ?? "no unit"}, but the meal needs ${component.unit}.`,
        };
      }

      const available = stock.quantity;
      const used = Math.min(available, component.quantity);
      stock.quantity = available - used;
      const shortfall = Number((component.quantity - used).toFixed(6));

      if (shortfall > 0) {
        const existing = shortfalls.get(key);
        shortfalls.set(key, {
          itemKey: component.itemKey,
          unit: component.unit,
          quantity: Number(((existing?.quantity ?? 0) + shortfall).toFixed(6)),
        });
      }

      return {
        itemKey: component.itemKey,
        needed: component.quantity,
        unit: component.unit,
        available,
        shortfall,
        coverage: shortfall > 0 ? "SHORT" : "COVERED",
        because:
          shortfall > 0
            ? `Short by ${shortfall} ${component.unit} once earlier meals are allowed for.`
            : "Already in the house.",
      };
    });

    const coverage = components.reduce<WeekMealCoverage>(
      (worst, line) => (SEVERITY[line.coverage] > SEVERITY[worst] ? line.coverage : worst),
      components.length === 0 ? "NEEDS_CHECK" : "COVERED",
    );

    planned.push({
      mealId: meal.mealId,
      label: meal.label,
      plannedFor: meal.plannedFor,
      coverage,
      components,
      ...(meal.note ? { note: meal.note } : {}),
    });
  }

  return {
    ...base,
    readyForPlanning: true,
    blockedReason: null,
    meals: planned,
    shortfalls: [...shortfalls.values()].sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
    notCountedItemKeys: [...notCounted].sort(),
  };
}
