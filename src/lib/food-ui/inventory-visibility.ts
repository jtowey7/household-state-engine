import type { OperatorInventoryItem } from "../operator-inventory.functions";

/**
 * Zero is a valid canonical stock state, but a zero-stock item is no longer
 * something the household has. Keep the canonical record for audit/replay while
 * omitting it from the normal "What you have" list.
 */
export function isVisibleHouseholdFood(item: Pick<OperatorInventoryItem, "quantity">): boolean {
  return item.quantity === null || item.quantity > 0;
}
