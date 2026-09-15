/**
 * Food OS — resolving what "add 3 litres of Milk" means when the household
 * already has Milk.
 *
 * A household event Correction states the amount that is now there. So adding
 * to an existing food must add the new amount to what is already recorded.
 * If the two amounts are not measured the same way, or the existing amount is
 * not recorded, nothing is guessed: the caller is told plainly what to do.
 */

import { normaliseHouseholdUnit, sameHouseholdUnit } from "../inventory-exception/unit-contract";

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
  if (!normaliseHouseholdUnit(input.unit)) {
    return {
      ok: false,
      message: `FoodOS does not recognise “${input.unit.trim()}”. Choose one of the amounts shown.`,
    };
  }

  const matches = input.existing.filter((food) => sameName(food.item, item));
  const match = matches.length === 1 ? matches[0]! : null;
  if (!match) return { ok: true, stateAfter: input.quantity, stateBefore: null, matchedItem: null };

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

  return {
    ok: true,
    stateAfter: match.quantity + input.quantity,
    stateBefore: match.quantity,
    matchedItem: match.item,
  };
}
