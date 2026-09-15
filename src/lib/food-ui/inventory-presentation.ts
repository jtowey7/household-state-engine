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
