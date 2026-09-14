/**
 * Parses natural household language such as "two packs of mince" or
 * "a bag of frozen peas" into an explicit item / quantity / unit triple.
 *
 * This never guesses: when the phrase does not state a countable amount and a
 * unit, the parse is reported as unresolved and the household surface must ask
 * for the missing parts rather than inventing them. It does not touch canonical
 * item reconciliation; it only prepares an explicit triple for confirmation.
 */
export type NaturalQuantityParse =
  | { resolved: true; item: string; quantity: number; unit: string }
  | { resolved: false; item: string };

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  couple: 2,
};

/** Canonical singular unit -> the spellings a household might type. */
const UNIT_SPELLINGS: Record<string, readonly string[]> = {
  pack: ["pack", "packs", "packet", "packets"],
  bag: ["bag", "bags"],
  box: ["box", "boxes"],
  bottle: ["bottle", "bottles"],
  tub: ["tub", "tubs"],
  jar: ["jar", "jars"],
  tin: ["tin", "tins"],
  can: ["can", "cans"],
  carton: ["carton", "cartons"],
  punnet: ["punnet", "punnets"],
  bunch: ["bunch", "bunches"],
  loaf: ["loaf", "loaves"],
  slice: ["slice", "slices"],
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  g: ["g", "gram", "grams"],
  l: ["l", "litre", "litres", "liter", "liters"],
  ml: ["ml", "millilitre", "millilitres"],
};

const UNIT_LOOKUP = new Map<string, string>(
  Object.entries(UNIT_SPELLINGS).flatMap(([canonical, spellings]) =>
    spellings.map((spelling) => [spelling, canonical] as const),
  ),
);

const AMOUNT_PATTERN = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i;

function cleanItem(value: string): string {
  return value.replace(/^of\s+/i, "").replace(/\s+/g, " ").trim();
}

export function parseNaturalQuantity(input: string): NaturalQuantityParse {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return { resolved: false, item: "" };

  const tokens = trimmed.split(" ");
  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";

  // "500g mince" / "500 g mince" — amount and unit fused or adjacent.
  const amountMatch = first.match(AMOUNT_PATTERN);
  if (amountMatch) {
    const quantity = Number(amountMatch[1]);
    const fusedUnit = amountMatch[2] ? UNIT_LOOKUP.get(amountMatch[2].toLowerCase()) : undefined;
    if (fusedUnit) {
      const item = cleanItem(tokens.slice(1).join(" "));
      if (item && Number.isFinite(quantity)) return { resolved: true, item, quantity, unit: fusedUnit };
      return { resolved: false, item: cleanItem(trimmed) };
    }
    const spacedUnit = UNIT_LOOKUP.get(second.toLowerCase());
    if (spacedUnit) {
      const item = cleanItem(tokens.slice(2).join(" "));
      if (item && Number.isFinite(quantity)) return { resolved: true, item, quantity, unit: spacedUnit };
    }
    return { resolved: false, item: cleanItem(trimmed) };
  }

  // "two packs of mince" / "a bag of frozen peas" / "a couple of packs of mince".
  const worded = NUMBER_WORDS[first.toLowerCase()];
  if (worded !== undefined) {
    const directUnit = UNIT_LOOKUP.get(second.toLowerCase());
    if (directUnit) {
      const item = cleanItem(tokens.slice(2).join(" "));
      if (item) return { resolved: true, item, quantity: worded, unit: directUnit };
    }

    // Natural speech often inserts "of" between the count and unit.
    if (second.toLowerCase() === "of") {
      const linkedUnit = UNIT_LOOKUP.get((tokens[2] ?? "").toLowerCase());
      if (linkedUnit) {
        const item = cleanItem(tokens.slice(3).join(" "));
        if (item) return { resolved: true, item, quantity: worded, unit: linkedUnit };
      }
    }
  }

  return { resolved: false, item: cleanItem(trimmed) };
}
