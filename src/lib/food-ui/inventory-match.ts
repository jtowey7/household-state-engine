/**
 * Conservative, presentation-only reconciliation of a typed food description
 * against the already-loaded canonical inventory.
 *
 * This never mutates anything, never invents an item, and never fuzzy-matches
 * on a weak or ambiguous signal: unless exactly one candidate is a strong
 * match, the household is asked to choose or type the item themselves.
 */

export interface MatchableInventoryItem {
  recordId: string;
  item: string;
}

export type InventoryMatch<T extends MatchableInventoryItem> =
  | { kind: "unique"; match: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "none" };

const STOP_WORDS = new Set([
  "of",
  "the",
  "a",
  "an",
  "some",
  "and",
  "with",
  "fresh",
  "pack",
  "packs",
  "bag",
  "bags",
  "box",
  "boxes",
  "bottle",
  "bottles",
  "tin",
  "tins",
  "can",
  "cans",
  "tub",
  "tubs",
  "jar",
  "jars",
  "carton",
  "cartons",
]);

function significantTokens(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((token) => (token.endsWith("es") && token.length > 4 ? token.slice(0, -2) : token))
    .map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens));
}

/**
 * A candidate is only "strong" when every significant token of the shorter
 * side is present on the other side — i.e. one name is a clean subset of the
 * other ("mince" vs "beef mince"). Partial overlap is deliberately not enough.
 */
function isStrongCandidate(typedTokens: string[], itemTokens: string[]): boolean {
  if (typedTokens.length === 0 || itemTokens.length === 0) return false;
  const [shorter, longer] =
    typedTokens.length <= itemTokens.length ? [typedTokens, itemTokens] : [itemTokens, typedTokens];
  const longerSet = new Set(longer);
  return shorter.every((token) => longerSet.has(token));
}

export function matchExistingInventory<T extends MatchableInventoryItem>(
  typedItem: string,
  inventory: readonly T[],
): InventoryMatch<T> {
  const typedTokens = significantTokens(typedItem);
  if (typedTokens.length === 0) return { kind: "none" };

  const exact = inventory.filter(
    (entry) => entry.item.trim().toLowerCase() === typedItem.trim().toLowerCase(),
  );
  if (exact.length === 1) return { kind: "unique", match: exact[0]! };

  const candidates = inventory.filter((entry) =>
    isStrongCandidate(typedTokens, significantTokens(entry.item)),
  );

  if (candidates.length === 1) return { kind: "unique", match: candidates[0]! };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "none" };
}
