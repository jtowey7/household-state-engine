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
