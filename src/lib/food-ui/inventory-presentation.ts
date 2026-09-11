export const COMMON_FOOD_UNITS = [
  "pack",
  "bag",
  "box",
  "bottle",
  "tin/can",
  "tub",
  "jar",
  "carton",
  "loaf",
  "kg",
  "g",
  "litre",
  "ml",
] as const;

export type CommonFoodUnit = (typeof COMMON_FOOD_UNITS)[number];

const UNIT_ALIASES: Record<string, CommonFoodUnit> = {
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  bag: "bag",
  bags: "bag",
  box: "box",
  boxes: "box",
  bottle: "bottle",
  bottles: "bottle",
  tub: "tub",
  tubs: "tub",
  jar: "jar",
  jars: "jar",
  tin: "tin/can",
  tins: "tin/can",
  can: "tin/can",
  cans: "tin/can",
  carton: "carton",
  cartons: "carton",
  loaf: "loaf",
  loaves: "loaf",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  l: "litre",
  litre: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
};

export function normalizeFoodUnit(value: string): string {
  const normalized = value.trim().toLowerCase();
  return UNIT_ALIASES[normalized] ?? normalized;
}

export const SOFT_FOOD_SECTIONS = [
  "Fresh",
  "Meat",
  "Fish",
  "Dairy",
  "Cupboard",
  "Frozen",
  "Drinks & Treats",
  "Other",
] as const;

export type SoftFoodSection = (typeof SOFT_FOOD_SECTIONS)[number];

const sectionRules: Array<{ section: SoftFoodSection; terms: string[] }> = [
  { section: "Frozen", terms: ["frozen", "ice cream", "ice lolly", "peas", "chips", "fries", "hash brown", "naan"] },
  { section: "Fish", terms: ["salmon", "mackerel", "sardine", "tuna", "cod", "haddock", "fish", "prawn", "prawns"] },
  { section: "Meat", terms: ["beef", "mince", "chicken", "lamb", "pork", "bacon", "ham", "sausage", "sausages", "chorizo", "turkey"] },
  { section: "Dairy", terms: ["milk", "cheese", "yogurt", "yoghurt", "cream", "butter", "custard", "crumpet", "egg", "eggs"] },
  { section: "Drinks & Treats", terms: ["cola", "pepsi", "juice", "squash", "coffee", "tea", "chocolate", "sweet", "sweets", "popcorn", "ice lolly", "magnum", "cornetto", "solero"] },
  { section: "Fresh", terms: ["apple", "pear", "banana", "berry", "berries", "tomato", "tomatoes", "cucumber", "pepper", "peppers", "carrot", "carrots", "celery", "lettuce", "broccoli", "fruit", "vegetable", "salad"] },
];

export function softFoodSection(item: string, category?: string | null): SoftFoodSection {
  const source = `${category ?? ""} ${item}`.trim().toLowerCase();
  const explicitCategory = (category ?? "").trim().toLowerCase();
  if (explicitCategory.includes("frozen")) return "Frozen";
  if (explicitCategory.includes("fish")) return "Fish";
  if (explicitCategory.includes("meat")) return "Meat";
  if (explicitCategory.includes("dairy")) return "Dairy";
  if (explicitCategory.includes("drink") || explicitCategory.includes("treat")) return "Drinks & Treats";
  if (explicitCategory.includes("fresh")) return "Fresh";
  if (explicitCategory.includes("cupboard") || explicitCategory.includes("pantry")) return "Cupboard";

  for (const rule of sectionRules) {
    if (rule.terms.some((term) => source.includes(term))) return rule.section;
  }
  return "Other";
}
