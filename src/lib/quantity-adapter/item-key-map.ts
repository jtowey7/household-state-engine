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
}

function indexMap(entries: readonly ItemKeyMapEntry[]): Map<string, ItemKeyMapEntry> {
  const index = new Map<string, ItemKeyMapEntry>();
  for (const entry of entries) {
    if (!entry.active && entry.active !== undefined) continue;
    if (!entry.alias || !entry.canonicalItemKey) continue;
    if (!Number.isFinite(entry.conversionFactor) || entry.conversionFactor <= 0) continue;
    if (index.has(entry.alias)) continue;
    index.set(entry.alias, entry);
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
  const resolved = targets.map((target) => {
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
  return { value: resolved, changed };
}

export function resolveQuantityHandoff(
  handoff: QuantityRequirementsHandoff,
  entries: readonly ItemKeyMapEntry[],
): ItemKeyMapResolution<QuantityRequirementsHandoff> {
  let changed = false;
  const items = handoff.items.map((item) => {
    if (item.unit === null) return item;
    const mapping = resolveItemKey(item.itemKey, item.unit, entries);
    if (!mapping.mapped) return item;
    changed = true;
    return {
      ...item,
      itemKey: mapping.itemKey,
      unit: mapping.unit,
      quantity: item.quantity * mapping.conversionFactor,
    };
  });

  const blockedItemKeys = handoff.blockedItemKeys.map((itemKey) => {
    const mapping = entries.find((entry) => entry.alias === itemKey && (entry.active ?? true));
    if (!mapping || !Number.isFinite(mapping.conversionFactor) || mapping.conversionFactor <= 0) {
      return itemKey;
    }
    changed = true;
    return mapping.canonicalItemKey;
  });

  return {
    changed,
    value: {
      ...handoff,
      items,
      blockedItemKeys: [...new Set(blockedItemKeys)].sort(),
    },
  };
}
