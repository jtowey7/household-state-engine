/**
 * Compact, household-friendly unit chips for the stock-action form.
 * These are presentation labels only — tapping a chip fills the free-text
 * Unit field with the exact label, so the user stays in control.
 */
export const COMMON_UNIT_CHIPS = [
  "packs",
  "each",
  "kg",
  "g",
  "litres",
  "ml",
  "cans",
] as const;

export type CommonUnitChip = (typeof COMMON_UNIT_CHIPS)[number];
