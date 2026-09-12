import type { OperatorInventoryItem } from "@/lib/operator-inventory.functions";

/**
 * Household action shortcuts for an existing inventory item.
 *
 * When someone marks food as Consumed or Discarded, the common case is that
 * the whole current amount is gone. These helpers keep that the one-tap path
 * while leaving the "some is left" path explicit. Nothing here infers
 * consumption from meals or time; it only pre-fills what the human chose.
 */

export type ActionPrefill = { item: string; quantity: string; unit: string };

/** Whole current quantity is gone → amount left is exactly 0. */
export function wholeAmountGonePrefill(item: OperatorInventoryItem): ActionPrefill {
  return { item: item.item, quantity: "0", unit: item.unit ?? "" };
}

/** Some was used/discarded → human enters the exact amount left. */
export function someLeftPrefill(item: OperatorInventoryItem): ActionPrefill {
  return { item: item.item, quantity: "", unit: item.unit ?? "" };
}

/**
 * Changed means "the recorded amount is wrong" — pre-fill the current amount
 * so the human corrects it explicitly.
 */
export function changedPrefill(item: OperatorInventoryItem): ActionPrefill {
  return {
    item: item.item,
    quantity: item.quantity == null ? "" : String(item.quantity),
    unit: item.unit ?? "",
  };
}
