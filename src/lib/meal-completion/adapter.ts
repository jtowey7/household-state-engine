/**
 * Food OS — PLANNED MEAL COMPLETION -> CANONICAL CONSUMPTION PROPOSAL.
 *
 * PREPARE only. This module produces `AppendIntent`s on the existing canonical
 * writer path and returns previews (`wouldWrite: false`). It holds no port, so
 * it is structurally unable to write Airtable or touch INVENTORY.
 */

import { hashOf } from "../state-engine/hash";
import { canonicaliseAppend } from "../event-writer/canonical";
import { previewOfRecord } from "../event-writer/preview";
import type { AppendIntent } from "../write-boundary/types";
import type {
  MealCompletionProposalOptions,
  MealCompletionProposalRun,
  MealConsumptionProposal,
  MealIngredientLine,
  MealProposalException,
  MealProposalFingerprint,
  PlannedMealCompletion,
} from "./types";

export const DEFAULT_ALLOWED_UNITS = ["g", "kg", "ml", "l", "unit", "pack"] as const;

interface AggregatedLine {
  itemKey: string;
  quantity: number;
  unit: string;
}

type AggregateOutcome =
  | { ok: true; line: AggregatedLine }
  | { ok: false; code: MealProposalException["code"]; detail: string };

/**
 * Deterministically aggregates duplicate ingredient lines for one item.
 * Never invents a quantity and never reconciles mismatched units.
 */
export function aggregateIngredientLines(
  itemKey: string,
  lines: readonly MealIngredientLine[],
  allowedUnits: readonly string[],
): AggregateOutcome {
  let total = 0;
  let unit: string | null = null;

  for (const line of lines) {
    const q = line.quantity;
    if (q === undefined || q === null || typeof q !== "number" || !Number.isFinite(q)) {
      return {
        ok: false,
        code: "MISSING_QUANTITY",
        detail: `${itemKey} has an ingredient line with no usable quantity; the item is isolated and no quantity is invented.`,
      };
    }
    if (q < 0) {
      return {
        ok: false,
        code: "INVALID_QUANTITY",
        detail: `${itemKey} has a negative planned quantity (${q}); refused rather than guessed.`,
      };
    }
    const u = (line.unit ?? "").trim();
    if (!u) {
      return { ok: false, code: "MISSING_UNIT", detail: `${itemKey} has an ingredient line with no unit.` };
    }
    if (!allowedUnits.includes(u)) {
      return {
        ok: false,
        code: "MISSING_UNIT",
        detail: `${itemKey} uses unit \`${u}\`, which is not in the household unit contract.`,
      };
    }
    if (unit === null) unit = u;
    else if (unit !== u) {
      return {
        ok: false,
        code: "UNIT_MISMATCH",
        detail: `${itemKey} mixes units (\`${unit}\` and \`${u}\`); the item is isolated rather than converted.`,
      };
    }
    total += q;
  }

  if (unit === null) {
    return { ok: false, code: "MISSING_UNIT", detail: `${itemKey} has no ingredient lines.` };
  }
  if (total === 0) {
    return { ok: false, code: "ZERO_QUANTITY", detail: `${itemKey} aggregates to 0 ${unit}; nothing to consume.` };
  }
  return { ok: true, line: { itemKey, quantity: total, unit } };
}

function provenanceOf(meal: PlannedMealCompletion, options: MealCompletionProposalOptions) {
  const actor = meal.actor ?? options.actor ?? "Food OS meal scheduler";
  const source = meal.source ?? options.source ?? "Planned meal completion";
  const confidence = meal.confidence ?? options.confidence ?? "High";
  const evidence =
    meal.evidence ??
    `planned meal completion ${meal.completionId} (meal ${meal.mealId}${meal.recipeId ? `, recipe ${meal.recipeId}` : ""}${meal.mealPlanId ? `, plan ${meal.mealPlanId}` : ""})`;
  return { actor, source, confidence, evidence };
}

/**
 * Turns completed planned meals into canonical Consumption proposals.
 * Repeated evaluation of the same completion is idempotent: identical
 * (completion, item, quantity, provenance) yields the same Event ID and is
 * deduped rather than queued twice.
 */
export function proposeMealCompletionConsumption(
  meals: readonly PlannedMealCompletion[],
  options: MealCompletionProposalOptions,
): MealCompletionProposalRun {
  const allowedUnits = options.allowedUnits ?? [...DEFAULT_ALLOWED_UNITS];
  const recordClass = options.recordClass ?? "Production";
  const known = new Map<string, MealProposalFingerprint>();
  for (const fp of options.knownProposals ?? []) known.set(fp.proposalKey, fp);
  const eventIdOwner = new Map<string, string>();
  for (const fp of known.values()) eventIdOwner.set(fp.eventId, fp.proposalKey);

  const proposals: MealConsumptionProposal[] = [];
  const deduped: MealProposalFingerprint[] = [];
  const exceptions: MealProposalException[] = [];

  const ordered = [...meals].sort((a, b) =>
    a.completionId === b.completionId ? a.mealId.localeCompare(b.mealId) : a.completionId.localeCompare(b.completionId),
  );

  for (const meal of ordered) {
    const base = { mealId: meal.mealId, completionId: meal.completionId };
    if (meal.state === "SKIPPED") {
      exceptions.push({ ...base, itemKey: null, code: "MEAL_SKIPPED", detail: `Meal ${meal.mealId} was skipped; no consumption is proposed.` });
      continue;
    }
    if (meal.state === "CANCELLED") {
      exceptions.push({ ...base, itemKey: null, code: "MEAL_CANCELLED", detail: `Meal ${meal.mealId} was cancelled; no consumption is proposed.` });
      continue;
    }
    if (meal.state === "CHANGED") {
      exceptions.push({
        ...base,
        itemKey: null,
        code: "MEAL_CHANGED_AWAITING_REPLACEMENT",
        detail: meal.replacedByCompletionId
          ? `Meal ${meal.mealId} was replanned; consumption must come from completion ${meal.replacedByCompletionId}, not the superseded plan.`
          : `Meal ${meal.mealId} was replanned; no replacement completion identity exists yet.`,
      });
      continue;
    }
    if (meal.state !== "COMPLETED") {
      exceptions.push({ ...base, itemKey: null, code: "MEAL_NOT_COMPLETED", detail: `Meal ${meal.mealId} is ${meal.state}; completion drives consumption.` });
      continue;
    }

    const occurredAt = meal.completedAt ?? meal.plannedFor;
    const { actor, source, confidence, evidence } = provenanceOf(meal, options);
    const provenanceHash = hashOf({
      mealId: meal.mealId,
      completionId: meal.completionId,
      mealPlanId: meal.mealPlanId ?? null,
      recipeId: meal.recipeId ?? null,
      mealName: meal.mealName ?? null,
      actor,
      source,
      confidence,
      evidence,
    });

    const byItem = new Map<string, MealIngredientLine[]>();
    for (const line of meal.ingredients) {
      const key = line.itemKey.trim();
      byItem.set(key, [...(byItem.get(key) ?? []), line]);
    }

    for (const itemKey of [...byItem.keys()].sort()) {
      const aggregate = aggregateIngredientLines(itemKey, byItem.get(itemKey)!, allowedUnits);
      if (!aggregate.ok) {
        exceptions.push({ ...base, itemKey, code: aggregate.code, detail: aggregate.detail });
        continue;
      }
      const { quantity, unit } = aggregate.line;

      const intent: AppendIntent = {
        eventType: "Consumption",
        item: itemKey,
        occurredAt,
        quantityDelta: -quantity,
        unit,
        source,
        actor,
        entityType: "Inventory item",
        evidence,
        confidence,
        recordClass,
        ...(meal.supersedes && meal.supersedes.length > 0 ? { supersedes: meal.supersedes } : {}),
      };

      const canonical = canonicaliseAppend(intent, { now: options.now });
      if (!canonical.ok) {
        exceptions.push({
          ...base,
          itemKey,
          code: "CANONICALISATION_REJECTED",
          detail: `${canonical.rejection.code}: ${canonical.rejection.detail}`,
        });
        continue;
      }

      const record = canonical.record;
      const proposalKey = `${meal.completionId}::${itemKey}`;
      const fingerprint: MealProposalFingerprint = {
        proposalKey,
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        provenanceHash,
      };

      const prior = known.get(proposalKey);
      if (prior) {
        if (prior.payloadHash !== fingerprint.payloadHash) {
          exceptions.push({
            ...base,
            itemKey,
            code: "PROPOSAL_PAYLOAD_CONFLICT",
            detail: `${itemKey}: completion ${meal.completionId} already proposed event ${prior.eventId}; the new quantity yields ${record.eventId}. Surfaced as a conflict rather than silently collapsed.`,
          });
          continue;
        }
        if (prior.provenanceHash !== fingerprint.provenanceHash) {
          exceptions.push({
            ...base,
            itemKey,
            code: "PROPOSAL_PROVENANCE_CONFLICT",
            detail: `${itemKey}: completion ${meal.completionId} already proposed event ${prior.eventId} with different provenance. Surfaced as a conflict rather than silently collapsed.`,
          });
          continue;
        }
        deduped.push(fingerprint);
        continue;
      }

      const owner = eventIdOwner.get(record.eventId);
      if (owner && owner !== proposalKey) {
        exceptions.push({
          ...base,
          itemKey,
          code: "PROPOSAL_PAYLOAD_CONFLICT",
          detail: `${itemKey}: event ${record.eventId} is already claimed by proposal ${owner}; a second identical consumption cannot be queued without a distinct occurred-at.`,
        });
        continue;
      }

      known.set(proposalKey, fingerprint);
      eventIdOwner.set(record.eventId, proposalKey);
      proposals.push({
        ...fingerprint,
        mealId: meal.mealId,
        completionId: meal.completionId,
        mealPlanId: meal.mealPlanId ?? null,
        recipeId: meal.recipeId ?? null,
        itemKey,
        quantity,
        unit,
        occurredAt,
        intent,
        record,
        preview: previewOfRecord(record),
        duplicateOfExisting: false,
        requiresHumanAuthorization: true,
      });
    }
  }

  return {
    proposals,
    deduped,
    exceptions,
    fingerprints: [...known.values()].sort((a, b) => a.proposalKey.localeCompare(b.proposalKey)),
  };
}
