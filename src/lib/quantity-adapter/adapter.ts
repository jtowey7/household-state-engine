import { hashOf } from "../shared/hash";
import type { QuantityRequirementsHandoff, QuantityRequirementPlan, QuantityRequirementTarget } from "../state-engine/types";

export function adaptSnapshotToQuantityRun(
  handoff: QuantityRequirementsHandoff,
  options: {
    targets: readonly QuantityRequirementTarget[];
    blockedItemPolicy?: "REFUSE_RUN" | "ISOLATE_ITEMS";
    isolatedItemKeys?: readonly string[];
    itemKeyMap?: readonly { recipeItemAlias: string; canonicalHouseholdItemKey: string; recipeUnit: string; canonicalUnit: string; conversionFactor: number; active: boolean }[];
  },
): QuantityRequirementPlan {
  const identity = {
    replayId: handoff.replayId,
    snapshotId: handoff.snapshotId,
    replayTimestamp: handoff.replayTimestamp,
    reconciliationStatus: handoff.reconciliationStatus,
  };

  const refuse = (rejection: { code: string; itemKey: string | null; detail: string; fatal: boolean }) => ({
    ...identity,
    planId: hashOf({ identity, rejection }),
    eligibleForProcurement: false,
    executed: false,
    requirements: [],
    rejections: [rejection],
  });

  if (!handoff.readyForQuantityRun) {
    return refuse({
      code: "QUANTITY_RUN_NOT_READY",
      itemKey: null,
      detail: "Household state handoff is not ready for quantity requirements.",
      fatal: true,
    });
  }

  if (handoff.reconciliationStatus === "BLOCKED") {
    return refuse({
      code: "RECONCILIATION_BLOCKED",
      itemKey: null,
      detail: "Replay reconciliation is blocked; quantity execution is refused.",
      fatal: true,
    });
  }

  const policy = options.blockedItemPolicy ?? "REFUSE_RUN";
  const isolated = new Set(options.isolatedItemKeys ?? []);
  if (policy === "REFUSE_RUN" && handoff.blockedItemKeys.length > 0) {
    return refuse({
      code: "RECONCILIATION_UNCERTAIN",
      itemKey: null,
      detail:
        "Replay reconciliation is uncertain (blocked items present or handoff not ready); execution refused.",
      fatal: true,
    });
  }
  if (policy === "ISOLATE_ITEMS") {
    for (const itemKey of handoff.blockedItemKeys) isolated.add(itemKey);
  }

  // ISOLATE_ITEMS: never invent a quantity for an isolated item, but let the
  // rest of the household keep planning.
  const isolatedRejections = [...isolated].sort().map((itemKey) => ({
    code: "ITEM_ISOLATED",
    itemKey,
    detail:
      "Item is blocked or uncertain in the replay snapshot; withheld from this quantity run.",
    fatal: false,
  }));

  const resolvedTargets = options.targets.map((target) => {
    if (!options.itemKeyMap) return target;
    const mappings = options.itemKeyMap.filter(
      (mapping) => mapping.recipeItemAlias === target.itemKey && mapping.active,
    );
    if (mappings.length === 0) return target;
    const canonicalKeys = new Set(mappings.map((mapping) => mapping.canonicalHouseholdItemKey));
    if (canonicalKeys.size !== 1) return target;
    const [canonical] = [...canonicalKeys];
    return canonical ? { ...target, itemKey: canonical } : target;
  });

  const targetDuplicates = new Set<string>();
  const seenTargets = new Set<string>();
  for (const target of resolvedTargets) {
    if (seenTargets.has(target.itemKey)) targetDuplicates.add(target.itemKey);
    seenTargets.add(target.itemKey);
  }
  if (targetDuplicates.size > 0) {
    return refuse({
      code: "DUPLICATE_DEMAND_TARGET",
      itemKey: [...targetDuplicates].sort()[0] ?? null,
      detail: `Multiple demand targets configured for the same item: ${[...targetDuplicates].sort().join(", ")}.`,
      fatal: true,
    });
  }

  const targets = new Map(resolvedTargets.map((t) => [t.itemKey, t]));
  const consolidate = (handoffValue: QuantityRequirementsHandoff) => {
    const rows = new Map<string, { itemKey: string; quantity: number; units: string[]; sourceEventIds: string[] }>();
    for (const row of handoffValue.items) {
      if (isolated.has(row.itemKey)) continue;
      const existing = rows.get(row.itemKey);
      if (!existing) {
        rows.set(row.itemKey, {
          itemKey: row.itemKey,
          quantity: row.quantity,
          units: [row.unit],
          sourceEventIds: [...row.sourceEventIds],
        });
        continue;
      }
      existing.quantity += row.quantity;
      if (!existing.units.includes(row.unit)) existing.units.push(row.unit);
      for (const eventId of row.sourceEventIds) {
        if (!existing.sourceEventIds.includes(eventId)) existing.sourceEventIds.push(eventId);
      }
    }
    return [...rows.values()].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  };

  const rejections = [...isolatedRejections];
  const requirements = [] as QuantityRequirementPlan["requirements"];
  const replayed = new Map(consolidate(handoff).map((row) => [row.itemKey, row]));

  // Inventory-only rows (no configured demand target) are not part of the
  // demand universe and never produce a procurement line.
  for (const row of replayed.values()) {
    if (isolated.has(row.itemKey)) continue;
    if (targets.has(row.itemKey)) continue;
    rejections.push({
      code: "NO_DEMAND_TARGET",
      itemKey: row.itemKey,
      detail: "No demand target configured for this item; line dropped.",
      fatal: false,
    });
  }

  // The demand universe is the configured targets: an item absent from the
  // replayed household state has a true on-hand of 0 and must still
  // be procured, rather than being silently omitted.
  for (const itemKey of [...targets.keys()].sort()) {
    if (isolated.has(itemKey)) continue;
    const target = targets.get(itemKey)!;
    const row = replayed.get(itemKey) ?? {
      itemKey,
      quantity: 0,
      units: [] as string[],
      sourceEventIds: [] as string[],
    };

    if (row.units.length > 1) {
      rejections.push({
        code: "UNIT_MISMATCH",
        itemKey: row.itemKey,
        detail: `Conflicting units in replay output: ${row.units.join(", ")}.`,
        fatal: false,
      });
      continue;
    }
    const unit = row.units[0] ?? null;
    if (unit !== null && unit !== target.unit) {
      rejections.push({
        code: "UNIT_MISMATCH",
        itemKey: row.itemKey,
        detail: `Replay unit "${unit}" does not match demand target unit "${target.unit}".`,
        fatal: false,
      });
      continue;
    }
    if (!Number.isFinite(row.quantity) || row.quantity < 0) {
      rejections.push({
        code: "NON_POSITIVE_QUANTITY",
        itemKey: row.itemKey,
        detail: `Invalid on-hand quantity ${row.quantity}; line dropped.`,
        fatal: false,
      });
      continue;
    }
    if (!Number.isFinite(target.targetQuantity) || target.targetQuantity <= 0) {
      rejections.push({
        code: "NON_POSITIVE_QUANTITY",
        itemKey: row.itemKey,
        detail: `Demand target must be > 0, received ${target.targetQuantity}.`,
        fatal: false,
      });
      continue;
    }

    const requiredQuantity = target.targetQuantity - row.quantity;
    if (requiredQuantity <= 0) continue;

    let packSize: number | null = null;
    let packCount: number | null = null;
    let packRoundedQuantity: number | null = null;
    if (target.packSize !== undefined) {
      if (!Number.isFinite(target.packSize) || target.packSize <= 0) {
        rejections.push({
          code: "PACK_ROUNDING_INCOMPATIBLE",
          itemKey: row.itemKey,
          detail: `Pack size must be > 0, received ${target.packSize}.`,
          fatal: false,
        });
        continue;
      }
      if (target.packUnit !== undefined && target.packUnit !== target.unit) {
        rejections.push({
          code: "PACK_ROUNDING_INCOMPATIBLE",
          itemKey: row.itemKey,
          detail: `Pack unit "${target.packUnit}" is not comparable with requirement unit "${target.unit}".`,
          fatal: false,
        });
        continue;
      }
      packSize = target.packSize;
      packCount = Math.ceil(requiredQuantity / target.packSize);
      packRoundedQuantity = packCount * target.packSize;
    }

    requirements.push({
      requirementId: hashOf({
        itemKey: row.itemKey,
        unit: target.unit,
        requiredQuantity,
        onHandQuantity: row.quantity,
        targetQuantity: target.targetQuantity,
        sourceEventIds: [...row.sourceEventIds],
        packSize,
      }),
      itemKey: row.itemKey,
      requiredQuantity,
      unit: target.unit,
      onHandQuantity: row.quantity,
      targetQuantity: target.targetQuantity,
      sourceEventIds: [...row.sourceEventIds],
      packSize,
      packCount,
      packRoundedQuantity,
    });
  }

  const hasDemandBlockingRejection = rejections.some(
    (rejection) => rejection.code !== "NO_DEMAND_TARGET" && rejection.code !== "ITEM_ISOLATED",
  );

  return {
    ...identity,
    planId: hashOf({ identity, requirements, rejections }),
    // A quantity plan is approval/procurement-ready only when every demanded
    // item was resolved. Explicitly isolated items are intentionally outside
    // this run's demand universe; other dropped/invalid demand items block.
    eligibleForProcurement: requirements.length > 0 && !hasDemandBlockingRejection,
    executed: true,
    requirements,
    rejections,
  };
}
