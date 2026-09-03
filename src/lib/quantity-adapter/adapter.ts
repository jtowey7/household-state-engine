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
  const resolvedTargetResult = resolveDemandTargets(options.targets, mapping);
  const resolvedTargets = resolvedTargetResult.value;
  const rejections: AdapterRejection[] = [];
  const requirements: QuantityRequirement[] = [];

  const identity = {
    replayId: handoff.replayId,
    snapshotId: handoff.snapshotId,
    replayTimestamp: handoff.replayTimestamp,
    reconciliationStatus: handoff.reconciliationStatus,
    blockedItemKeys: [...handoff.blockedItemKeys],
  };

  const refuse = (plan: AdapterRejection): QuantityRunPlan => ({
    ...identity,
    planId: hashOf({ identity, refused: plan }),
    eligibleForProcurement: false,
    executed: false,
    requirements: [],
    rejections: [plan],
  });

  const explicitlyIsolated = new Set(options.isolatedItemKeys ?? []);
  const unresolvedAmbiguities = resolvedTargetResult.blockedItemKeys.filter(
    (itemKey) => !explicitlyIsolated.has(itemKey),
  );
  if (unresolvedAmbiguities.length > 0) {
    return refuse({
      code: "AMBIGUOUS_ITEM_KEY_MAPPING",
      itemKey: unresolvedAmbiguities[0] ?? null,
      detail: `Active ITEM KEY MAP entries conflict for demand target ${unresolvedAmbiguities.join(", ")}; canonical identity is ambiguous, so quantity/procurement is refused.`,
      fatal: true,
    });
  }

  const policy = options.blockedItemPolicy ?? "REFUSE_RUN";
  const mappedIsolated = (options.isolatedItemKeys ?? []).flatMap((itemKey) => {
    const matches = mapping.filter((entry) => entry.alias === itemKey && (entry.active ?? true));
    if (matches.length === 0) return [itemKey];
    const first = matches[0];
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
  const isolated = new Set<string>([
    ...handoff.blockedItemKeys,
    ...mappedIsolated,
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
      detail: "Item is explicitly isolated from quantity planning.",
      fatal: false,
    });
  }

  for (const target of resolvedTargets) {
    if (isolated.has(target.itemKey)) continue;

    const matches = handoff.items.filter((item) => item.itemKey === target.itemKey);
    if (matches.length === 0) {
      rejections.push({
        code: "NO_DEMAND_TARGET",
        itemKey: target.itemKey,
        detail: `No replayed stock row exists for demand target ${target.itemKey}.`,
        fatal: false,
      });
      continue;
    }

    const units = new Set(matches.map((item) => item.unit).filter((unit): unit is string => unit !== null));
    if (units.size > 1 || (units.size === 1 && !units.has(target.unit))) {
      rejections.push({
        code: "UNIT_MISMATCH",
        itemKey: target.itemKey,
        detail: `Replayed stock unit(s) ${[...units].sort().join(", ")} do not match demand unit ${target.unit}.`,
        fatal: false,
      });
      continue;
    }

    const onHand = matches.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isFinite(onHand) || onHand < 0) {
      rejections.push({
        code: "NON_POSITIVE_QUANTITY",
        itemKey: target.itemKey,
        detail: `Replayed on-hand quantity ${onHand} is invalid.`,
        fatal: true,
      });
      continue;
    }

    const quantity = Math.max(0, target.targetQuantity - onHand);
    if (quantity <= 0) continue;

    requirements.push({
      itemKey: target.itemKey,
      quantity,
      unit: target.unit,
      sourceEventIds: [...new Set(matches.flatMap((item) => item.sourceEventIds))].sort(),
      provenance: "REPLAY",
      packSize: target.packSize,
      packUnit: target.packUnit,
    });
  }

  const fatal = rejections.some((rejection) => rejection.fatal);
  const eligibleForProcurement = !fatal && rejections.every((rejection) => rejection.code !== "RECONCILIATION_UNCERTAIN");
  return {
    ...identity,
    planId: hashOf({ identity, requirements, rejections }),
    eligibleForProcurement,
    executed: true,
    requirements: consolidateRequirements(requirements),
    rejections,
  };
}

function consolidateRequirements(requirements: QuantityRequirement[]): QuantityRequirement[] {
  const byKey = new Map<string, QuantityRequirement>();
  for (const requirement of requirements) {
    const prior = byKey.get(requirement.itemKey);
    if (!prior) {
      byKey.set(requirement.itemKey, { ...requirement });
      continue;
    }
    prior.quantity += requirement.quantity;
    prior.sourceEventIds = [...new Set([...prior.sourceEventIds, ...requirement.sourceEventIds])].sort();
  }
  return [...byKey.values()].sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}
