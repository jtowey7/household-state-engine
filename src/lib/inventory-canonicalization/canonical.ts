import type {
  CanonicalInventoryItem,
  InventoryCanonicalisationResult,
  InventoryRecord,
  InventoryUnitFamily,
} from "./types";

const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  millilitre: 1,
  millilitres: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
  "fl oz": 29.5735295625,
  "fluid ounce": 29.5735295625,
  "fluid ounces": 29.5735295625,
};

const COUNT_UNITS = new Set(["each", "item", "items", "unit", "units"]);

function normaliseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normaliseVariant(value: string | null | undefined): string | null {
  const normalised = value ? normaliseText(value) : "";
  return normalised || null;
}

export function classifyUnit(unit: string): InventoryUnitFamily {
  const key = normaliseText(unit);
  if (COUNT_UNITS.has(key)) return "COUNT";
  if (key in MASS_TO_GRAMS) return "MASS";
  if (key in VOLUME_TO_ML) return "VOLUME";
  return "OTHER";
}

function conversionFactor(unit: string, family: InventoryUnitFamily): number | null {
  const key = normaliseText(unit);
  if (family === "MASS") return MASS_TO_GRAMS[key] ?? null;
  if (family === "VOLUME") return VOLUME_TO_ML[key] ?? null;
  if (family === "COUNT" && COUNT_UNITS.has(key)) return 1;
  return null;
}

function canonicalUnitFor(family: InventoryUnitFamily): string {
  if (family === "MASS") return "g";
  if (family === "VOLUME") return "ml";
  if (family === "COUNT") return "each";
  return "";
}

/**
 * Builds a stable identity key without attempting semantic fuzzy matching.
 * Variants are explicit discriminators; location, batch, expiry and provenance
 * are deliberately excluded so they survive inside the canonical item's batches.
 */
export function inventoryIdentityKey(record: Pick<InventoryRecord, "item" | "variant">): string {
  const item = normaliseText(record.item);
  const variant = normaliseVariant(record.variant);
  return variant ? `${item}::${variant}` : item;
}

function sortBatches(a: InventoryRecord, b: InventoryRecord): number {
  return a.recordId.localeCompare(b.recordId);
}

/**
 * Deterministically aggregates only records whose units are safely comparable.
 * Unknown units and mixed unit families are retained as separate unmergeable
 * records rather than guessed into a common quantity.
 */
export function canonicaliseInventory(records: InventoryRecord[]): InventoryCanonicalisationResult {
  const groups = new Map<string, InventoryRecord[]>();
  const unmergeableRecordIds: string[] = [];

  for (const record of records) {
    if (!record.recordId || !record.item || !Number.isFinite(record.quantity) || !record.unit) {
      unmergeableRecordIds.push(record.recordId);
      continue;
    }

    const family = classifyUnit(record.unit);
    if (family === "OTHER" || conversionFactor(record.unit, family) === null) {
      unmergeableRecordIds.push(record.recordId);
      continue;
    }

    const key = `${inventoryIdentityKey(record)}::${family}`;
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  }

  const items: CanonicalInventoryItem[] = [];

  for (const recordsForKey of groups.values()) {
    const ordered = [...recordsForKey].sort(sortBatches);
    const first = ordered[0];
    const family = classifyUnit(first.unit);
    const factor = conversionFactor(first.unit, family);

    if (!factor) {
      unmergeableRecordIds.push(...ordered.map((record) => record.recordId));
      continue;
    }

    const totalQuantity = ordered.reduce((sum, record) => {
      const recordFactor = conversionFactor(record.unit, family);
      if (recordFactor === null) return sum;
      return sum + record.quantity * recordFactor;
    }, 0);

    items.push({
      identityKey: inventoryIdentityKey(first),
      item: first.item.trim(),
      variant: normaliseVariant(first.variant),
      unitFamily: family,
      canonicalUnit: canonicalUnitFor(family),
      totalQuantity,
      sourceRecordIds: ordered.map((record) => record.recordId),
      batches: ordered.map((record) => ({
        recordId: record.recordId,
        quantity: record.quantity,
        unit: normaliseText(record.unit),
        location: record.location ?? null,
        bestBefore: record.bestBefore ?? null,
        source: record.source ?? null,
        delivered: record.delivered ?? null,
        notes: record.notes ?? null,
      })),
    });
  }

  items.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  unmergeableRecordIds.sort();

  return { items, unmergeableRecordIds };
}
