import { describe, expect, it } from "vitest";

import type { QuantityRequirementsHandoff } from "../state-engine/types";
import { buildHouseholdWeekPlan } from "./plan";
import type { PlannedWeekMeal } from "./types";

const handoff = (items: QuantityRequirementsHandoff["items"]): QuantityRequirementsHandoff => ({
  replayId: "replay-1",
  snapshotId: "snapshot-1",
  replayTimestamp: "1970-01-01T00:00:00.000Z",
  reconciliationStatus: "CLEAN",
  canonicalReconciliationStatus: "CLEAN",
  readyForQuantityRun: true,
  items,
  blockedItemKeys: [],
});

const meals: PlannedWeekMeal[] = [
  {
    mealId: "M1",
    label: "Buttered toast",
    plannedFor: "2026-09-08",
    state: "PLANNED",
    components: [{ itemKey: "butter", quantity: 100, unit: "g" }],
  },
];

describe("week plan item identity", () => {
  it("asks for a check when one item is counted under two names", () => {
    const plan = buildHouseholdWeekPlan(
      handoff([
        { itemKey: "Butter", quantity: 500, unit: "g", evidencePrecision: "EXACT", sourceEventIds: ["E1"] },
        { itemKey: "butter", quantity: 20, unit: "g", evidencePrecision: "EXACT", sourceEventIds: ["E2"] },
      ]),
      meals,
    );

    const line = plan.meals[0]?.components[0];
    expect(line?.coverage).toBe("NEEDS_CHECK");
    expect(line?.available).toBe(0);
    expect(line?.shortfall).toBe(0);
    expect(plan.meals[0]?.coverage).toBe("NEEDS_CHECK");
    expect(plan.shortfalls).toEqual([]);
  });

  it("plans normally when each item is counted once", () => {
    const plan = buildHouseholdWeekPlan(
      handoff([
        { itemKey: "butter", quantity: 500, unit: "g", evidencePrecision: "EXACT", sourceEventIds: ["E1"] },
      ]),
      meals,
    );

    expect(plan.meals[0]?.components[0]?.coverage).toBe("COVERED");
    expect(plan.meals[0]?.components[0]?.available).toBe(500);
  });
});
