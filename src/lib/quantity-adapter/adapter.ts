import { hashOf } from "../state-engine/hash";
import { toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { QuantityRequirementsHandoff, StateSnapshot } from "../state-engine/types";
import { resolveDemandTargets, resolveQuantityHandoff } from "./item-key-map";
import type {
  AdapterOptions,
  AdapterRejection,
  QuantityRequirement,
  QuantityRunPlan,
} from "./types";

function isSnapshot(input: StateSnapshot | QuantityRequirementsHandoff): input is StateSnapshot {
  return "items" in input && "contributingEventIds" in input;
}

interface Consolidated {
  itemKey: string;
  quantity: number;
  units: string[];
  sourceEventIds: string[];
}

/** Consolidates duplicate requirement lines per item, preserving provenance order. */
function consolidate(handoff: QuantityRequirementsHandoff): Consolidated[] {
  const byKey = new Map<string, Consolidated>();
  for (const item of handoff.items) {
    let row = byKey.get(item.itemKey);
    if (!row) {
      row = { itemKey: item.itemKey, quantity: 0, units: [], sourceEventIds: [] };
      byKey.set(item.itemKey, row);
    }
    row.quantity += item.quantity;
    if (item.unit !== null && !row.units.includes(item.unit)) row.units.push(item.unit);
    for (const id of item.sourceEventIds) {
      if (!row.sourceEventIds.includes(id)) row.sourceEventIds.push(id);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

/**
 * Pure adapter: State Engine output -> deterministic quantity requirements.
 * Never mutates its inputs and performs no I/O.
 */
export function adaptSnapshotToQuantityRun(
  input: StateSnapshot | QuantityRequirementsHandoff | null | undefined,
  options: AdapterOptions,
): QuantityRunPlan {
  // There is deliberately NO static-inventory fallback: without a replay
  // snapshot the adapter refuses rather than inventing on-hand quantities.
  if (input === null || input === undefined) {
    const missing = {
      code: "MISSING_REPLAY_SNAPSHOT" as const,
      itemKey: null,
      detail:
        "No replay snapshot supplied; the adapter refuses to fall back to static inventory.",
      fatal: true,
    };
    return {
      replayId: "",
      snapshotId: "",
      replayTimestamp: "",
      reconciliationStatus: "BLOCKED",
      blockedItemKeys: [],
      planId: hashOf({ missing }),
      eligibleForProcurement: false,
      executed: false,
      requirements: [],
      rejections: [missing],
    };
  }

  const rawHandoff = isSnapshot(input) ? toQuantityRequirementsHandoff(input) : input;
  const mapping = options.itemKeyMap ?? [];
  const handoff = resolveQuantityHandoff(rawHandoff, mapping).value;
  const resolvedTargets = resolveDemandTargets(options.targets, mapping).value;
  const rejections: AdapterRejection[] = [];
  const requirements: QuantityRequirement[] = [];

  const identity = {
    replayId: handoff.replayId,
    snapshotId: handoff.snapshotId,
    replayTimestamp: handoff.replayTimestamp,
    reconciliationStatus: handoff.reconciliationStatus,
    blockedItemKeys: [...handoff.blockedItemKeys],
  };

  // Plan identity binds to the MATERIALISED-state status, not the evidence
  // status. An identical duplicate delivery is audit evidence only: it must not
  // change planId (and therefore basketId/approval identity) while the
  // materialised snapshot is byte-identical. Real conflicts still change it.
  //
  // replayTimestamp is deliberately EXCLUDED: it is wall-clock provenance, not
  // state. Including it made re-replaying an unchanged event log produce a new
  // planId/basketId/approval identity on every run, which is non-deterministic
  // output provenance. It stays on the plan as evidence.
  const { replayTimestamp: _replayTimestampProvenance, ...identityWithoutClock } = identity;
  const identityForHash = {
    ...identityWithoutClock,
    reconciliationStatus:
      handoff.canonicalReconciliationStatus ?? handoff.reconciliationStatus,
  };

  const refuse = (plan: AdapterRejection): QuantityRunPlan => ({
    ...identity,
    planId: hashOf({ identity: identityForHash, refused: plan }),
    eligibleForProcurement: false,
    executed: false,
    requirements: [],
    rejections: [plan],
  });

  const policy = options.blockedItemPolicy ?? "REFUSE_RUN";
  const mappedIsolated = (options.isolatedItemKeys ?? []).flatMap((itemKey) => {
    const matches = mapping.filter((entry) => entry.alias === itemKey && (entry.active ?? true));
    if (matches.length === 0) return [itemKey];
    const first = matches[0]!;
    const identical = matches.every(
      (entry) =>
        entry.canonicalItemKey === first.canonicalItemKey &&
        entry.sourceUnit === first.sourceUnit &&
        entry.canonicalUnit === first.canonicalUnit &&
        entry.conversionFactor === first.conversionFactor,
    );
    // Ambiguous aliases must remain isolated under their original identity.
    // Selecting the first matching canonical key would allow an uncertain
    // alias to escape the isolation set and re-enter quantity planning.
    return identical ? [first.canonicalItemKey] : [itemKey];
  });
  // Qualified/ambiguous on-hand evidence is explicitly unsuitable for automatic
  // quantity decisions (the State Engine blocks it for exactly this reason).
  // A handoff row may still carry it — trusting it as exact would under-procure
  // on uncertain evidence, so isolate it here rather than reading it.
  const qualifiedEvidence = handoff.items
    .filter((item) => item.evidencePrecision !== "EXACT")
    .map((item) => item.itemKey);
  const isolated = new Set<string>([
    ...handoff.blockedItemKeys,
    ...mappedIsolated,
    ...qualifiedEvidence,
  ]);

  if (handoff.reconciliationStatus === "BLOCKED" && policy === "REFUSE_RUN") {
    return refuse({
      code: "RECONCILIATION_BLOCKED",
      itemKey: null,
      detail: "Replay reconciliation is BLOCKED; no quantity requirements emitted.",
      fatal: true,
    });
  }
  if (policy === "REFUSE_RUN" && (!handoff.readyForQuantityRun || isolated.size > 0)) {
    return refuse({
      code: "RECONCILIATION_UNCERTAIN",
      itemKey: null,
      detail:
        "Replay reconciliation is uncertain (blocked items present or handoff not ready); execution refused.",
      fatal: true,
    });
  }

  // ISOLATE_ITEMS: never invent a quantity for an isolated item, but let the
  // rest of the household keep planning.
  for (const itemKey of [...isolated].sort()) {
    rejections.push({
      code: "ITEM_ISOLATED",
      itemKey,
      detail:
        "Item is blocked or uncertain in the replay snapshot; withheld from this quantity run.",
      fatal: false,
    });
  }

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
  // replayed household state has a true on-hand of 0 and must still be
  // procured, rather than being silently omitted.
  const targetKeys = [...targets.keys()].sort();
  for (const itemKey of targetKeys) {
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
    if (requiredQuantity <= 0) {
      rejections.push({
        code: "NON_POSITIVE_QUANTITY",
        itemKey: row.itemKey,
        detail: `On-hand ${row.quantity} ${target.unit} already meets target ${target.targetQuantity}; nothing to procure.`,
        fatal: false,
      });
      continue;
    }

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

  return {
    ...identity,
    planId: hashOf({ identity: identityForHash, requirements, rejections }),
    eligibleForProcurement: requirements.length > 0,
    executed: true,
    requirements,
    rejections,
  };
}
