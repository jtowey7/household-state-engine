/**
 * Presentation-only browsing helpers for the household food list.
 *
 * These never mutate anything and never invent context: a location or
 * category is only offered as a filter when the food record already carries a
 * real, human-meaningful value.
 */

export interface BrowsableFood {
  item: string;
  location?: string | null;
  category?: string | null;
}

const IGNORED_VALUES = new Set([
  "",
  "needs a home",
  "needs a category",
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

export function browsableCategories(items: readonly BrowsableFood[]): string[] {
  return distinctSorted(items.map((item) => item.category));
}

/** Name, location and category all count as things people search by. */
export function matchesFoodSearch(item: BrowsableFood, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const searchable = [item.item, item.location, item.category]
    .filter((value) => value === item.item || isBrowsableValue(value))
    .join("\u0000")
    .toLowerCase();
  return searchable.includes(q);
}

export interface BrowseFilters {
  query?: string;
  location?: string | null;
  category?: string | null;
}

export function filterBrowsableFoods<T extends BrowsableFood>(
  items: readonly T[],
  filters: BrowseFilters,
): T[] {
  const { query = "", location = null, category = null } = filters;
  return items.filter((item) => {
    if (!matchesFoodSearch(item, query)) return false;
    if (location && (item.location ?? "").trim() !== location) return false;
    if (category && (item.category ?? "").trim() !== category) return false;
    return true;
  });
}
