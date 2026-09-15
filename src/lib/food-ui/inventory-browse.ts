/**
 * Presentation-only browsing helpers for the household food list.
 *
 * Food is never classified and never browsed by storage place: categories and
 * storage locations are a deprecated household concept. People find food by
 * its name, and nothing else is invented on their behalf.
 */

export interface BrowsableFood {
  item: string;
}

/** Name is the only thing people search by. */
export function matchesFoodSearch(item: BrowsableFood, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return item.item.toLowerCase().includes(q);
}

export interface BrowseFilters {
  query?: string;
}

export function filterBrowsableFoods<T extends BrowsableFood>(
  items: readonly T[],
  filters: BrowseFilters,
): T[] {
  const { query = "" } = filters;
  return items.filter((item) => matchesFoodSearch(item, query));
}
