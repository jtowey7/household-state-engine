import type {
  CurrentWeekQuantityMaterialisation,
  CurrentWeekQuantityMaterialisationInput,
  MaterialisationRefusal,
  ProposedQuantityRequirement,
} from "./types";

/**
 * Materialise fresh, snapshot-bound QUANTITY REQUIREMENTS proposals for the
 * current household week from an existing deterministic quantity run plan.
 *
 * Fails closed: a blocked/refused replay or a week with no Production meals
 * yields zero proposals. There is no static-INVENTORY fallback — the plan is
 * the only source of on-hand truth, and it already refuses without a replay
 * snapshot. Existing rows bound to a different snapshot are reported as stale
 * and are never reused as if they were current.
 */
export function prepareCurrentWeekQuantityRequirements(
  input: CurrentWeekQuantityMaterialisationInput,
): CurrentWeekQuantityMaterialisation {
  const { plan, weekStartIso, weekEndIso } = input;
  const mealPlanIds = [...new Set(input.mealPlanIds.filter((id) => typeof id === "string" && id.trim()))].sort();
  const existingRows = input.existingRows ?? [];
  const refusals: MaterialisationRefusal[] = [];

  const staleRecordIds = existingRows
    .filter((row) => (row.snapshotId ?? "") !== plan.snapshotId)
    .map((row) => row.recordId)
    .sort();

  const base = {
    executed: false as const,
    approvalRequired: true as const,
    snapshotId: plan.snapshotId,
    replayId: plan.replayId,
    replayTimestamp: plan.replayTimestamp,
    reconciliationStatus: plan.reconciliationStatus,
    weekStartIso,
    weekEndIso,
    mealPlanIds,
    staleRecordIds,
  };

  if (plan.reconciliationStatus === "BLOCKED") {
    refusals.push({
      code: "RECONCILIATION_BLOCKED",
      detail: "Replay reconciliation is BLOCKED; no quantity requirements are materialised.",
    });
  }
  if (!plan.executed || plan.rejections.some((rejection) => rejection.fatal)) {
    refusals.push({
      code: "QUANTITY_RUN_REFUSED",
      detail: "The deterministic quantity run refused; no requirements are derived from a partial state.",
    });
  }
  if (mealPlanIds.length === 0) {
    refusals.push({
      code: "MISSING_CURRENT_WEEK_MEALS",
      detail: "No current-week Production MEAL PLANS supplied; requirements are not bound to an unknown week.",
    });
  }

  if (refusals.length > 0) {
    return { ...base, ok: false, proposals: [], unchangedRequirementIds: [], refusals };
  }

  const boundRequirementIds = new Set(
    existingRows
      .filter((row) => (row.snapshotId ?? "") === plan.snapshotId)
      .map((row) => row.requirementId ?? "")
      .filter(Boolean),
  );

  const proposals: ProposedQuantityRequirement[] = [];
  const unchangedRequirementIds: string[] = [];

  for (const requirement of [...plan.requirements].sort((a, b) => a.itemKey.localeCompare(b.itemKey))) {
    const requirementId = requirement.requirementId;
    if (!requirementId) {
      return {
        ...base,
        ok: false,
        proposals: [],
        unchangedRequirementIds: [],
        refusals: [
          {
            code: "QUANTITY_RUN_REFUSED",
            detail: `${requirement.itemKey} has no deterministic requirement identity; no requirement is materialised.`,
          },
        ],
      };
    }
    if (boundRequirementIds.has(requirementId)) {
      unchangedRequirementIds.push(requirementId);
      continue;
    }
    proposals.push({
      requirementId,
      itemKey: requirement.itemKey,
      fields: {
        Requirement: `${requirement.itemKey} — ${weekStartIso.slice(0, 10)} (${plan.snapshotId.slice(0, 12)})`,
        Meal: [...mealPlanIds],
        Item: requirement.itemKey,
        "Required quantity": requirement.requiredQuantity,
        Unit: requirement.unit,
        "Calculation status": "Calculated",
        "Household state snapshot ID": plan.snapshotId,
        "State reconciliation status": plan.reconciliationStatus,
      },
      provenance: {
        snapshotId: plan.snapshotId,
        replayId: plan.replayId,
        replayTimestamp: plan.replayTimestamp,
        reconciliationStatus: plan.reconciliationStatus,
        sourceEventIds: [...requirement.sourceEventIds],
        weekStartIso,
        weekEndIso,
      },
    });
  }

  if (proposals.length === 0 && unchangedRequirementIds.length === 0) {
    refusals.push({
      code: "NO_REQUIREMENTS_DERIVED",
      detail: "The quantity run produced no requirement lines for this week; nothing is materialised.",
    });
    return { ...base, ok: false, proposals: [], unchangedRequirementIds: [], refusals };
  }

  return { ...base, ok: true, proposals, unchangedRequirementIds: unchangedRequirementIds.sort(), refusals };
}
