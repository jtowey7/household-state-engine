/**
 * FoodOS household food grouping — PRESENTATION ONLY.
 *
 * Canonical Location and Category remain useful household context. Category
 * leads the friendly grouping when it maps cleanly; the food name is only a
 * fallback. Neither field is required, so every inventory record is still
 * rendered exactly once with its recorded quantity untouched.
 */

export interface GroupableFood {
  item: string;
  category?: string | null;
}

export type FoodGroupName =
  | "Fresh food"
  | "Meat & fish"
  | "Frozen"
  | "Cupboard"
  | "Drinks"
  | "Other";

export const FOOD_GROUP_ORDER: readonly FoodGroupName[] = [
  "Fresh food",
  "Meat & fish",
  "Frozen",
  "Cupboard",
  "Drinks",
  "Other",
];

const GROUP_EMOJI: Record<FoodGroupName, string> = {
  "Fresh food": "🥬",
  "Meat & fish": "🐟",
  Frozen: "❄️",
  Cupboard: "🥫",
  Drinks: "🧃",
  Other: "🧺",
};

const KEYWORDS: ReadonlyArray<readonly [FoodGroupName, readonly string[]]> = [
  ["Frozen", ["frozen", "ice ", "ice cream", "peas"]],
  [
    "Meat & fish",
    [
      "chicken", "beef", "mince", "pork", "lamb", "bacon", "sausage", "ham",
      "turkey", "salmon", "cod", "tuna", "prawn", "fish", "haddock",
    ],
  ],
  [
    "Drinks",
    ["juice", "milk", "water", "squash", "coffee", "tea", "wine", "beer", "cordial"],
  ],
  [
    "Fresh food",
    [
      "lettuce", "salad", "spinach", "kale", "pak choi", "tomato", "cucumber",
      "pepper", "carrot", "potato", "onion", "garlic", "broccoli", "courgette",
      "mushroom", "apple", "banana", "orange", "berry", "berries", "lemon",
      "lime", "herb", "coriander", "parsley", "basil", "yoghurt", "yogurt",
      "cheese", "butter", "egg", "cream",
    ],
  ],
  [
    "Cupboard",
    [
      "rice", "pasta", "noodle", "flour", "sugar", "salt", "oil", "vinegar",
      "tin", "tinned", "can ", "bean", "chickpea", "lentil", "sauce", "stock",
      "spice", "cereal", "oat", "bread", "crisp", "biscuit", "honey", "jam",
      "couscous", "tortilla", "flatbread",
    ],
  ],
];

const CATEGORY_KEYWORDS: ReadonlyArray<readonly [FoodGroupName, readonly string[]]> = [
  ["Frozen", ["frozen"]],
  ["Meat & fish", ["meat", "fish", "seafood"]],
  ["Drinks", ["drink", "beverage"]],
  ["Fresh food", ["fresh", "fruit", "vegetable", "produce", "dairy", "egg"]],
  ["Cupboard", ["cupboard", "pantry", "bakery", "store cupboard"]],
];

function matchingGroup(
  value: string,
  rules: ReadonlyArray<readonly [FoodGroupName, readonly string[]]>,
): FoodGroupName | null {
  for (const [group, words] of rules) {
    if (words.some((word) => value.includes(word))) return group;
  }
  return null;
}

export function groupNameForFood(food: GroupableFood): FoodGroupName {
  const category = (food.category ?? "").toLowerCase().trim();
  const categoryGroup = matchingGroup(category, CATEGORY_KEYWORDS);
  if (categoryGroup) return categoryGroup;

  const name = (food.item ?? "").toLowerCase().trim();
  if (name === "") return "Other";
  return matchingGroup(name, KEYWORDS) ?? "Other";
}

export function foodGroupEmoji(group: FoodGroupName): string {
  return GROUP_EMOJI[group];
}

/**
 * Groups every item into the fixed household order. Missing or unfamiliar
 * canonical context never excludes an item; name matching and Other remain
 * forgiving fallbacks.
 */
export function groupFoods<T extends GroupableFood>(
  items: readonly T[],
): Array<[FoodGroupName, T[]]> {
  const buckets = new Map<FoodGroupName, T[]>();
  for (const item of items) {
    const group = groupNameForFood(item);
    buckets.set(group, [...(buckets.get(group) ?? []), item]);
  }
  return FOOD_GROUP_ORDER.flatMap((group) => {
    const bucket = buckets.get(group);
    return bucket && bucket.length > 0 ? [[group, bucket] as [FoodGroupName, T[]]] : [];
  });
}
