/**
 * Supermarket-style grouping for the inventory list — deliberately NOT an
 * AI call. This runs instantly, for free, every time an item is added or
 * renamed, so there is no periodic job, no credits spent, and nothing to
 * "resequence" on a schedule: the list is always already in order.
 *
 * It is a plain keyword lookup, not a smart classifier — biased toward
 * being free and instant over being perfect. Anything unmatched lands in
 * "Other" rather than guessing. If specific items keep landing there or
 * in the wrong aisle, the fix is to extend CATEGORY_KEYWORDS, not to add
 * an AI call. Matching is whole-word only (plus simple plurals), never a
 * substring of an unrelated word — a naive substring check would match
 * "pea" inside "peanut", "corn" inside "cornflour", "veg" inside
 * "vegetable", or "tea" inside "steak".
 */

/** Supermarket aisle order: fresh near the entrance, frozen and dry goods
 * further in, drinks and treats last, unclassified items at the very end. */
export const CATEGORY_ORDER = [
  "Fruit & veg",
  "Meat & fish",
  "Dairy & eggs",
  "Bread & bakery",
  "Frozen",
  "Tins & packets",
  "Drinks",
  "Snacks & treats",
  "Other",
] as const;

export type Category = (typeof CATEGORY_ORDER)[number];

const CATEGORY_KEYWORDS: { category: Category; keywords: string[] }[] = [
  {
    category: "Fruit & veg",
    keywords: [
      "apple",
      "banana",
      "carrot",
      "potato",
      "onion",
      "tomato",
      "broccoli",
      "lettuce",
      "cucumber",
      "pepper",
      "mushroom",
      "berry",
      "berries",
      "lemon",
      "lime",
      "orange",
      "grape",
      "salad",
      "spinach",
      "garlic",
      "avocado",
      "courgette",
      "sweetcorn",
      "fruit",
      "pea",
      "peas",
      "melon",
      "pear",
      "kiwi",
      "herb",
      "vegetable",
      "vegetables",
      "strawberry",
      "strawberries",
      "blueberry",
      "blueberries",
      "blackberry",
      "blackberries",
      "raspberry",
      "raspberries",
      "cranberry",
      "cranberries",
      "apricot",
      "apricots",
      "romaine",
    ],
  },
  {
    category: "Meat & fish",
    keywords: [
      "chicken",
      "beef",
      "pork",
      "lamb",
      "mince",
      "bacon",
      "sausage",
      "fish",
      "salmon",
      "tuna",
      "prawn",
      "turkey",
      "ham",
      "steak",
      "nugget",
      "meat",
      "cod",
      "burger",
      "burgers",
    ],
  },
  {
    category: "Dairy & eggs",
    keywords: [
      "milk",
      "cheese",
      "yoghurt",
      "yogurt",
      "butter",
      "cream",
      "egg",
      "cheddar",
      "halloumi",
      "custard",
      "parmesan",
      "parmigiano",
    ],
  },
  {
    category: "Bread & bakery",
    keywords: [
      "bread",
      "roll",
      "bun",
      "bagel",
      "croissant",
      "cake",
      "pastry",
      "muffin",
      "bakery",
      "pitta",
      "naan",
      "loaf",
      "crumpet",
      "tortilla",
      "wrap",
      "breadstick",
      "breadsticks",
    ],
  },
  {
    category: "Tins & packets",
    keywords: [
      "pasta",
      "spaghetti",
      "rice",
      "cereal",
      "flour",
      "sugar",
      "sauce",
      "beans",
      "lentil",
      "soup",
      "stock",
      "spice",
      "oil",
      "vinegar",
      "jar",
      "noodle",
      "gravy",
      "ketchup",
      "mayo",
      "jam",
      "honey",
      "passata",
      "fusilli",
      "bucatini",
      "lasagne",
      "lasagna",
      "quinoa",
      "bulgur",
      "penne",
      "macaroni",
      "olive",
      "olives",
      "salsa",
      "seed",
      "seeds",
      "caper",
      "capers",
      "dumpling",
      "breadcrumb",
      "salt",
      "chickpea",
      "chickpeas",
      // Common spices/herbs — the dry-goods aisle, not Fruit & veg.
      "cinnamon",
      "allspice",
      "cumin",
      "curry",
      "paprika",
      "cardamom",
      "ginger",
      "nutmeg",
      "oregano",
      "chilli",
      "chili",
      "turmeric",
      "rosemary",
      "parsley",
      "cajun",
      "thyme",
      "basil",
      "mustard",
      "clove",
      "cloves",
      "seasoning",
      "powder",
    ],
  },
  {
    category: "Drinks",
    keywords: [
      "juice",
      "squash",
      "cordial",
      "water",
      "cola",
      "soda",
      "tea",
      "coffee",
      "wine",
      "beer",
      "drink",
      "pop",
    ],
  },
  {
    category: "Snacks & treats",
    keywords: [
      "crisp",
      "chocolate",
      "biscuit",
      "sweet",
      "snack",
      "nut",
      "popcorn",
      "cracker",
      "pretzel",
      "cashew",
      "walnut",
      "pecan",
    ],
  },
];

/** Checked before anything else so e.g. "tinned tomatoes" lands in Tins &
 * packets rather than Fruit & veg, and "frozen peas" lands in Frozen
 * rather than Fruit & veg — the preparation state wins over the
 * ingredient. */
const PRIORITY_RULES: { pattern: RegExp; category: Category }[] = [
  {
    pattern: /\btin(ned)?\b|\bcanned\b|\bcan of\b|\bin (water|brine)\b/,
    category: "Tins & packets",
  },
  {
    pattern: /\bfrozen\b|\bice[\s-]?cream\b|\bpizza\b|\blolly\b|\blollies\b|\bfries\b/,
    category: "Frozen",
  },
];

/** Supermarket own-brands and common UK grocery brands — stripped from the
 * front of an item name because the product is the same regardless of
 * which shop or brand it came from ("Tesco onions" and "onions" are the
 * same thing to cook with). Longer names first so e.g. "marks & spencer"
 * is tried before a shorter brand that happens to be a prefix of it. */
const BRAND_PREFIXES = [
  "marks & spencer",
  "marks and spencer",
  "lea & perrins",
  "uncle ben's",
  "uncle bens",
  "sainsbury's",
  "sainsburys",
  "birds eye",
  "yeo valley",
  "allinson's",
  "allinsons",
  "mcvitie's",
  "mcvities",
  "colman's",
  "colmans",
  "hellmann's",
  "hellmanns",
  "jacob's",
  "jacobs",
  "morrisons",
  "waitrose",
  "iceland",
  "warburtons",
  "kingsmill",
  "mccain",
  "napolina",
  "batchelors",
  "branston",
  "kellogg's",
  "kelloggs",
  "ocado",
  "booths",
  "tesco",
  "asda",
  "aldi",
  "lidl",
  "m&s",
  "co-op",
  "coop",
  "spar",
  "heinz",
  "walkers",
  "cadbury",
  "hovis",
  "quorn",
  "müller",
  "muller",
  "arla",
  "ryvita",
  "nestlé",
  "nestle",
  "danone",
  "alpro",
  "hp",
].sort((a, b) => b.length - a.length);

/** Strips a trailing descriptor that just repeats what the item's own
 * quantity/unit fields already say — e.g. "Crumpets 6 Pack" when quantity
 * is already 6 and unit "crumpets", or "Tomato Passata 500G" when
 * quantity/unit already say 500 g. Runs after the brand strip and repeats
 * until nothing more matches, since a name can have more than one such
 * suffix stacked up. */
function stripRedundantSuffixes(name: string): string {
  let current = name;
  for (let i = 0; i < 5; i++) {
    const next = current
      .replace(/\s*\(?\d+(\.\d+)?\s*(kg|g|ml|cl|l)\)?$/i, "")
      .replace(/\s+each$/i, "")
      .replace(/\s*\([a-z]\)$/i, "")
      .replace(/\s+\d+\s*pack$/i, "")
      .trim();
    if (next === current || next.length === 0) break;
    current = next;
  }
  return current;
}

/**
 * Cleans up a grocery item name for display: strips a leading supermarket
 * or grocery brand, then strips any trailing size/count descriptor that
 * only repeats the item's own quantity/unit fields. Deliberately a plain
 * string transform (no AI call) — same reasoning as categoriseItem: this
 * runs on every list load, so it has to be free and instant, and "mostly
 * right, clearly better than before" beats a probabilistic call for a
 * cosmetic cleanup. Idempotent: running it twice on an already-clean name
 * is a no-op, which is what lets the lazy pass in familyInventoryApiResponse
 * run on every GET without rewriting rows that are already clean.
 */
export function normaliseInventoryName(rawName: string): string {
  const collapsed = rawName.trim().replace(/\s+/g, " ");
  const lower = collapsed.toLowerCase();

  let withoutBrand = collapsed;
  for (const brand of BRAND_PREFIXES) {
    if (lower.startsWith(brand + " ")) {
      withoutBrand = collapsed.slice(brand.length).trim();
      break;
    }
  }

  const cleaned = stripRedundantSuffixes(withoutBrand);
  if (cleaned.length === 0) return collapsed;
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

export function categoriseItem(name: string): Category {
  const lower = name.toLowerCase();
  for (const { pattern, category } of PRIORITY_RULES) {
    if (pattern.test(lower)) return category;
  }

  // Scan whole words from the end of the name backward: the head noun of
  // a descriptive product name ("Tesco Lean Beef Steak Mince 750g" ->
  // "mince") is usually closer to the end than an earlier qualifier
  // ("beef"). Exact/simple-plural equality only — never substring
  // containment, which is what let short keywords false-match inside
  // unrelated words.
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]!;
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
      if (keywords.some((kw) => word === kw || word === kw + "s" || word === kw + "es"))
        return category;
    }
  }
  return "Other";
}
