/**
 * FoodOS household stock session — PRESENTATION BRIDGE ONLY.
 *
 * The stock a household has counted on "Enter what you have" is kept in this
 * browser only, so the weekly plan surface can read exactly the same entries.
 * It contacts nothing, proposes nothing and never touches a household record.
 */

import type { StockEntryInput } from "../household-stock-readout";

const KEY = "foodos.household-stock-entries.v1";

export const stockObservedAt = "2026-09-05T09:30:00.000Z";
export const stockNow = () => "2026-09-05T10:00:00.000Z";
export const stockReportedBy = "household operator";

export const defaultStockEntries: readonly StockEntryInput[] = [
  { entryId: "entry-1", itemKey: "Chicken breast", quantity: 2, unit: "pack", observedAt: stockObservedAt },
  { entryId: "entry-2", itemKey: "Basmati rice", quantity: 900, unit: "g", observedAt: stockObservedAt },
];

function isEntry(value: unknown): value is StockEntryInput {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row["entryId"] === "string" && typeof row["itemKey"] === "string";
}

/** Read the counted entries. Falls back to the starting example, never invents stock. */
export function loadStockEntries(): StockEntryInput[] {
  if (typeof window === "undefined") return [...defaultStockEntries];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [...defaultStockEntries];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultStockEntries];
    return parsed.filter(isEntry);
  } catch {
    return [...defaultStockEntries];
  }
}

export function saveStockEntries(entries: readonly StockEntryInput[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable — the surface simply keeps this session's entries */
  }
}
