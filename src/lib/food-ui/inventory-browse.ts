/**
 * Presentation-only browsing helpers for the household food list.
 *
 * These never mutate anything and never invent context: a location is only
 * offered as a filter when the food record already carries a real,
 * human-meaningful value. Food is never classified or categorised.
 */

export interface BrowsableFood {
  item: string;
  location?: string | null | undefined;
}

const IGNORED_VALUES = new Set([
  "",
  "needs a home",
  "not recorded",
  "unknown",
]);

export function isBrowsableValue(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed.length > 0 && !IGNORED_VALUES.has(trimmed);
}

function distinctSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (isBrowsableValue(value)) set.add((value as string).trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function browsableLocations(items: readonly BrowsableFood[]): string[] {
  return distinctSorted(items.map((item) => item.location));
}

/** Name and location are the only things people search by. */
export function matchesFoodSearch(item: BrowsableFood, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const searchable = [item.item, item.location]
    .filter((value) => value === item.item || isBrowsableValue(value))
    .join("\u0000")
    .toLowerCase();
  return searchable.includes(q);
}

export interface BrowseFilters {
  query?: string;
  location?: string | null;
}

export function filterBrowsableFoods<T extends BrowsableFood>(
  items: readonly T[],
  filters: BrowseFilters,
): T[] {
  const { query = "", location = null } = filters;
  return items.filter((item) => {
    if (!matchesFoodSearch(item, query)) return false;
    if (location && (item.location ?? "").trim() !== location) return false;
    return true;
  });
}
