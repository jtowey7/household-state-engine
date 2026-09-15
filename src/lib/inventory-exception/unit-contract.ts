/**
 * Food OS — the canonical HOUSEHOLD UNIT CONTRACT.
 *
 * The household surface offers everyday words ("packs", "litres", "cans").
 * The canonical event payload stores one base unit per unit family. This
 * module is the ONLY place where an everyday word is mapped onto a canonical
 * unit, so the UI and the write boundary can never drift apart again.
 *
 * Nothing here guesses: an unrecognised word returns null and the caller
 * fails closed.
 */

/** The canonical units a HOUSEHOLD EVENT may carry. */
export const HOUSEHOLD_UNIT_CONTRACT = ["g", "kg", "ml", "l", "unit", "pack", "can"] as const;

export type HouseholdUnit = (typeof HOUSEHOLD_UNIT_CONTRACT)[number];

const SPELLINGS: Record<string, HouseholdUnit> = {
  g: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  unit: "unit",
  units: "unit",
  each: "unit",
  ea: "unit",
  item: "unit",
  items: "unit",
  piece: "unit",
  pieces: "unit",
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  can: "can",
  cans: "can",
  tin: "can",
  tins: "can",
};

/**
 * Maps an everyday household unit word onto its canonical contract unit.
 * Returns null when the word is not part of the contract; the caller must
 * refuse rather than invent a unit.
 */
export function normaliseHouseholdUnit(value: string | null | undefined): HouseholdUnit | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!key) return null;
  return SPELLINGS[key] ?? null;
}

/** True when two everyday unit words mean the same canonical unit. */
export function sameHouseholdUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseHouseholdUnit(a);
  const right = normaliseHouseholdUnit(b);
  return left !== null && left === right;
}
