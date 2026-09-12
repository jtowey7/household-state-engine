/**
 * FoodOS household food grouping — PRESENTATION ONLY.
 *
 * The consumer surface no longer groups by physical location or category:
 * those fields are obsolete for the household journey and must never block
 * an item from being shown. This maps a food's name into a small, forgiving
 * kitchen grouping with an "Other" fallback, so every inventory record is
 * always rendered exactly once with its recorded quantity untouched.
 */

export interface GroupableFood {
  item: string;
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

export function groupNameForFood(food: GroupableFood): FoodGroupName {
  const name = (food.item ?? "").toLowerCase().trim();
  if (name === "") return "Other";
  for (const [group, words] of KEYWORDS) {
    if (words.some((word) => name.includes(word))) return group;
  }
  return "Other";
}

export function foodGroupEmoji(group: FoodGroupName): string {
  return GROUP_EMOJI[group];
}

/**
 * Groups every item into the fixed household order. Missing or empty
 * location/category fields are irrelevant here and never exclude an item.
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
