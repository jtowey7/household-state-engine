import { describe, expect, it } from "vitest";

import { buildHouseholdStockReadout } from "../household-stock-readout";
import type { StockEntryInput } from "../household-stock-readout";
import { buildHouseholdWeekPlan } from "./plan";
import type { PlannedWeekMeal } from "./types";

const OBSERVED_AT = "2026-09-05T09:30:00.000Z";
const now = () => "2026-09-05T10:00:00.000Z";

function readout(entries: readonly StockEntryInput[]) {
  return buildHouseholdStockReadout(entries, { now, reportedBy: "James" });
}

const MEALS: readonly PlannedWeekMeal[] = [
  {
    mealId: "M2",
    label: "Rice bowls",
    plannedFor: "2026-09-08T18:30:00.000Z",
    state: "PLANNED",
    components: [{ itemKey: "Basmati rice", quantity: 400, unit: "g" }],
  },
  {
    mealId: "M1",
    label: "Chicken traybake",
    plannedFor: "2026-09-07T18:30:00.000Z",
    state: "PLANNED",
    components: [{ itemKey: "Basmati rice", quantity: 300, unit: "g" }],
  },
  {
    mealId: "M0",
    label: "Already cooked",
    plannedFor: "2026-09-06T18:30:00.000Z",
    state: "COMPLETED",
    components: [{ itemKey: "Basmati rice", quantity: 900, unit: "g" }],
  },
];

describe("household week plan", () => {
  it("covers meals from approved stock, drawing it down in planned order", () => {
    const plan = buildHouseholdWeekPlan(
      readout([
        {
          entryId: "e1",
          itemKey: "Basmati rice",
          quantity: 900,
          unit: "g",
          observedAt: OBSERVED_AT,
          approved: true,
        },
      ]).handoff,
      MEALS,
    );

    expect(plan.readyForPlanning).toBe(true);
    expect(plan.meals.map((m) => m.mealId)).toEqual(["M0", "M1", "M2"]);
    expect(plan.meals[0]!.coverage).toBe("NOT_PLANNED");
    expect(plan.meals[1]!.coverage).toBe("COVERED");
    expect(plan.meals[2]!.coverage).toBe("COVERED");
    expect(plan.meals[2]!.components[0]!.available).toBe(600);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.productionMutation).toBe(false);
  });

  it("reports a shortfall once earlier meals have taken their share", () => {
    const plan = buildHouseholdWeekPlan(
      readout([
        {
          entryId: "e1",
          itemKey: "Basmati rice",
          quantity: 500,
          unit: "g",
          observedAt: OBSERVED_AT,
          approved: true,
        },
      ]).handoff,
      MEALS,
    );

    expect(plan.meals[1]!.coverage).toBe("COVERED");
    expect(plan.meals[2]!.coverage).toBe("SHORT");
    expect(plan.shortfalls).toEqual([{ itemKey: "Basmati rice", quantity: 200, unit: "g" }]);
  });

  it("never assumes stock that has not been counted or approved", () => {
    const plan = buildHouseholdWeekPlan(
      readout([
        {
          entryId: "e1",
          itemKey: "Basmati rice",
          quantity: 900,
          unit: "g",
          observedAt: OBSERVED_AT,
        },
      ]).handoff,
      MEALS,
    );

    expect(plan.meals[1]!.coverage).toBe("NOT_COUNTED");
    expect(plan.notCountedItemKeys).toEqual(["Basmati rice"]);
  });

  it("fails closed on an incomparable unit rather than converting", () => {
    const plan = buildHouseholdWeekPlan(
      readout([
        {
          entryId: "e1",
          itemKey: "Basmati rice",
          quantity: 2,
          unit: "pack",
          observedAt: OBSERVED_AT,
          approved: true,
        },
      ]).handoff,
      MEALS,
    );

    expect(plan.meals[1]!.coverage).toBe("NEEDS_CHECK");
    expect(plan.shortfalls).toEqual([]);
  });

  it("refuses to plan at all when the handoff is not ready", () => {
    const handoff = readout([
      {
        entryId: "e1",
        itemKey: "Basmati rice",
        quantity: 900,
        unit: "g",
        observedAt: OBSERVED_AT,
        approved: true,
      },
    ]).handoff;

    const plan = buildHouseholdWeekPlan(
      { ...handoff, readyForQuantityRun: false, blockedItemKeys: ["Basmati rice"] },
      MEALS,
    );

    expect(plan.readyForPlanning).toBe(false);
    expect(plan.blockedReason).toBeTruthy();
    expect(plan.meals.every((m) => m.components.length === 0)).toBe(true);
    expect(plan.shortfalls).toEqual([]);
  });

  it("is deterministic for identical input", () => {
    const handoff = readout([
      {
        entryId: "e1",
        itemKey: "Basmati rice",
        quantity: 500,
        unit: "g",
        observedAt: OBSERVED_AT,
        approved: true,
      },
    ]).handoff;

    expect(JSON.stringify(buildHouseholdWeekPlan(handoff, MEALS))).toEqual(
      JSON.stringify(buildHouseholdWeekPlan(handoff, MEALS)),
    );
  });
});
