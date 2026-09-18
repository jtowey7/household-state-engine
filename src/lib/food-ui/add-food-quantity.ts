/**
 * Food OS — resolving what "add 3 litres of Milk" means when the household
 * already has Milk.
 *
 * A household event Correction states the amount that is now there. Adding to
 * an existing food therefore adds the new amount to the existing amount after
 * converting both quantities into the same canonical base unit. This means,
 * for example, that litres and pints can safely be combined without forcing
 * the household to use the same everyday measure.
 */

import { normaliseHouseholdUnit, sameHouseholdUnit, toCanonicalHouseholdQuantity } from "../inventory-exception/unit-contract";

export interface ExistingFood {
  item: string;
  quantity: number | null;
  unit: string | null;
}

export type AddedAmount =
  | { ok: true; stateAfter: number; stateBefore: number | null; matchedItem: string | null }
  | { ok: false; message: string };

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveAddedAmount(input: {
  item: string;
  quantity: number;
  unit: string;
  existing: readonly ExistingFood[];
}): AddedAmount {
  const item = input.item.trim();
  if (!item) return { ok: false, message: "Give the food a name." };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, message: "Give an amount greater than zero." };
  }
  const inputCanonicalUnit = normaliseHouseholdUnit(input.unit);
  const inputCanonicalQuantity = toCanonicalHouseholdQuantity(input.quantity, input.unit);
  if (!inputCanonicalUnit || inputCanonicalQuantity === null) {
    return {
      ok: false,
      message: `FoodOS does not recognise “${input.unit.trim()}”. Choose one of the amounts shown.`,
    };
  }

  const matches = input.existing.filter((food) => sameName(food.item, item));
  const match = matches.length === 1 ? matches[0]! : null;
  if (!match) return { ok: true, stateAfter: inputCanonicalQuantity, stateBefore: null, matchedItem: null };

  if (!sameHouseholdUnit(match.unit, input.unit)) {
    return {
      ok: false,
      message: `Your ${match.item} is measured in ${match.unit ?? "a different way"}. Use the same measure, or add it as a separate food.`,
    };
  }
  if (match.quantity === null || !Number.isFinite(match.quantity)) {
    return {
      ok: false,
      message: `FoodOS does not have an amount recorded for ${match.item}, so it cannot add to it. Use Changed to say how much there is now.`,
    };
  }

  const existingCanonicalQuantity = toCanonicalHouseholdQuantity(match.quantity, match.unit);
  if (existingCanonicalQuantity === null) {
    return {
      ok: false,
      message: `FoodOS cannot safely convert the existing amount for ${match.item}. Use Changed to say how much there is now.`,
    };
  }

  return {
    ok: true,
    stateAfter: existingCanonicalQuantity + inputCanonicalQuantity,
    stateBefore: existingCanonicalQuantity,
    matchedItem: match.item,
  };
}
