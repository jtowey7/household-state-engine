import type { QuantityRequirementsHandoff } from "../state-engine/types";
import type { DemandTarget } from "./types";

/**
 * Evidence-backed alias between planning/recipe vocabulary and the exact
 * household/procurement item key emitted by replay or catalogue data.
 *
 * Conversion is deliberately explicit: if the source unit does not match the
 * value being resolved, the mapping is ignored rather than inferred.
 */
export interface ItemKeyMapEntry {
  alias: string;
  canonicalItemKey: string;
  sourceUnit: string;
  canonicalUnit: string;
  conversionFactor: number;
  active?: boolean;
}

export interface ItemKeyMapResolution<T> {
  value: T;
  changed: boolean;
  blockedItemKeys?: string[];
}

function sameMapping(a: ItemKeyMapEntry, b: ItemKeyMapEntry): boolean {
  return (
    a.alias === b.alias &&
    a.canonicalItemKey === b.canonicalItemKey &&
    a.sourceUnit === b.sourceUnit &&
    a.canonicalUnit === b.canonicalUnit &&
    a.conversionFactor === b.conversionFactor
  );
}

/**
 * Build an alias index that fails closed when the authoritative map contains
 * conflicting active rows for the same alias. Identical duplicate rows are
 * harmless; conflicting rows are deliberately represented as null so callers
 * cannot silently select whichever record happened to arrive first.
 */
function indexMap(entries: readonly ItemKeyMapEntry[]): Map<string, ItemKeyMapEntry | null> {
  const index = new Map<string, ItemKeyMapEntry | null>();
  for (const entry of entries) {
    if (!entry.active && entry.active !== undefined) continue;
    if (!entry.alias || !entry.canonicalItemKey) continue;
    if (!Number.isFinite(entry.conversionFactor) || entry.conversionFactor <= 0) continue;

    const prior = index.get(entry.alias);
    if (prior === undefined) {
      index.set(entry.alias, entry);
      continue;
    }
    if (prior !== null && !sameMapping(prior, entry)) {
      index.set(entry.alias, null);
    }
  }
  return index;
}

export function resolveItemKey(
  itemKey: string,
  unit: string,
  entries: readonly ItemKeyMapEntry[],
): { itemKey: string; unit: string; conversionFactor: number; mapped: boolean } {
  const entry = indexMap(entries).get(itemKey);
  if (!entry || entry.sourceUnit !== unit) {
    return { itemKey, unit, conversionFactor: 1, mapped: false };
  }
  return {
    itemKey: entry.canonicalItemKey,
    unit: entry.canonicalUnit,
    conversionFactor: entry.conversionFactor,
    mapped: true,
  };
}

export function resolveDemandTargets(
  targets: readonly DemandTarget[],
  entries: readonly ItemKeyMapEntry[],
): ItemKeyMapResolution<DemandTarget[]> {
  let changed = false;
  const blockedItemKeys: string[] = [];
  const index = indexMap(entries);
  const resolved = targets.map((target) => {
    const entry = index.get(target.itemKey);
    if (entry === null) {
      blockedItemKeys.push(target.itemKey);
      return target;
    }
    const mapping = resolveItemKey(target.itemKey, target.unit, entries);
    if (!mapping.mapped) return target;
    changed = true;
    return {
      ...target,
      itemKey: mapping.itemKey,
      targetQuantity: target.targetQuantity * mapping.conversionFactor,
      unit: mapping.unit,
      ...(target.packSize !== undefined
        ? {
            packSize: target.packSize * mapping.conversionFactor,
            packUnit: mapping.unit,
          }
        : {}),
    };
  });
  const uniqueBlockedItemKeys = [...new Set(blockedItemKeys)].sort();
  return uniqueBlockedItemKeys.length > 0
    ? { value: resolved, changed, blockedItemKeys: uniqueBlockedItemKeys }
    : { value: resolved, changed };
}

export function resolveQuantityHandoff(
  handoff: QuantityRequirementsHandoff,
  entries: readonly ItemKeyMapEntry[],
): ItemKeyMapResolution<QuantityRequirementsHandoff> {
  const changed = false;
  const items = handoff.items.map((item) => {
    if (item.unit === null) return item;

    // QuantityRequirementsHandoff is emitted by authoritative household-state
    // replay, so item.itemKey is already the canonical household identity. It
    // must never be treated as recipe vocabulary and remapped through ITEM KEY
    // MAP: a coincident alias can redirect on-hand stock to another identity.
    // Keep the entries parameter in the signature for API compatibility and
    // make the canonical-identity boundary explicit here.
    void entries;
    return item;
  });

  // blockedItemKeys are emitted by the authoritative household-state replay
  // and therefore already use the canonical household identity. They carry no
  // unit, so treating them as recipe aliases is unsafe: a coincident alias can
  // redirect the block to a different canonical key and allow the originally
  // blocked item back into procurement. Preserve these identities verbatim.
  return {
    changed,
    value: {
      ...handoff,
      items,
      blockedItemKeys: [...new Set(handoff.blockedItemKeys)].sort(),
    },
  };
}
