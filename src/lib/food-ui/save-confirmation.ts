/**
 * Food OS — a save is only "saved" once the household record reads it back.
 *
 * Appending a canonical HOUSEHOLD EVENT is necessary but NOT sufficient: the
 * household list the person is looking at comes from the authoritative
 * inventory readback. Reporting "Saved" from the append receipt alone would
 * claim more than FoodOS knows.
 *
 * This helper compares what the person stated against what the household
 * record actually reads back afterwards, and states the truth plainly. It
 * changes no authority, no provenance and no write behaviour.
 */

import { sameHouseholdUnit } from "../inventory-exception/unit-contract";

export interface ReadbackItemLike {
  item: string;
  quantity: number | null;
  unit: string;
}

export interface SaveConfirmation {
  /** True only when the household record now reads back the stated amount. */
  confirmed: boolean;
  label: string;
  message: string;
}

function sameItem(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function confirmSavedAgainstReadback(input: {
  itemKey: string;
  statedStateAfter: number | string | null;
  unit: string;
  items: readonly ReadbackItemLike[] | null;
}): SaveConfirmation {
  const stated = typeof input.statedStateAfter === "string" ? Number(input.statedStateAfter) : input.statedStateAfter;

  if (input.items === null) {
    return {
      confirmed: false,
      label: "Not confirmed",
      message: `FoodOS recorded this change, but could not read your food list back just now, so it cannot confirm ${input.itemKey} is up to date. Open your food again in a moment.`,
    };
  }

  const match = input.items.find((entry) => sameItem(entry.item, input.itemKey));
  if (!match) {
    return {
      confirmed: false,
      label: "Not confirmed",
      message: `FoodOS recorded this change, but ${input.itemKey} is not showing in your food list yet, so nothing is being claimed as up to date.`,
    };
  }

  if (stated === null || !Number.isFinite(stated)) {
    return { confirmed: true, label: "Saved", message: `${input.itemKey} is up to date in your food list.` };
  }

  const unitAgrees = !input.unit.trim() || !match.unit.trim() || sameHouseholdUnit(match.unit, input.unit);
  if (match.quantity === stated && unitAgrees) {
    return { confirmed: true, label: "Saved", message: `${input.itemKey} is up to date in your food list.` };
  }

  return {
    confirmed: false,
    label: "Not confirmed",
    message: `FoodOS recorded this change, but your food list still shows a different amount for ${input.itemKey}, so it has not been confirmed. Check it again shortly.`,
  };
}
