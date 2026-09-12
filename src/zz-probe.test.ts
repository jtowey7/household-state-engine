import { describe, it, expect } from "vitest";
import { buildHouseholdWeekPlan } from "@/lib/household-week-plan/plan";
import { adaptSnapshotToQuantityRun } from "@/lib/quantity-adapter/adapter";
import type { QuantityRequirementsHandoff } from "@/lib/state-engine/types";

const h = (items: QuantityRequirementsHandoff["items"]): QuantityRequirementsHandoff => ({
  replayId: "r", snapshotId: "s", replayTimestamp: "t",
  reconciliationStatus: "CLEAN", canonicalReconciliationStatus: "CLEAN",
  readyForQuantityRun: true, items, blockedItemKeys: [],
});

describe("probe", () => {
  it("case-colliding item keys", () => {
    const plan = buildHouseholdWeekPlan(h([
      { itemKey: "Butter", quantity: 500, unit: "g", evidencePrecision: "EXACT", sourceEventIds: ["E1"] },
      { itemKey: "butter", quantity: 20, unit: "g", evidencePrecision: "EXACT", sourceEventIds: ["E2"] },
    ]), [{ mealId: "M1", label: "Toast", plannedFor: "2026-09-08", state: "PLANNED",
        components: [{ itemKey: "butter", quantity: 100, unit: "g" }] }]);
    console.log(JSON.stringify(plan.meals[0]?.components, null, 1));
  });

  it("qualified ambiguous evidence not in blockedItemKeys", () => {
    const plan = adaptSnapshotToQuantityRun(h([
      { itemKey: "salmon", quantity: 780, unit: "g", evidencePrecision: "QUALIFIED_AMBIGUOUS", sourceEventIds: ["E1"] },
    ]), { targets: [{ itemKey: "salmon", targetQuantity: 1000, unit: "g" }] });
    console.log(JSON.stringify({ req: plan.requirements, rej: plan.rejections }));
  });
});
