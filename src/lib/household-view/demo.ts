/**
 * FoodOS household view models — PRESENTATION ONLY.
 *
 * This module invents no household facts. It re-labels the synthetic demo
 * fixtures that already exist in the engineering libraries (sweep items,
 * consumption plan opening balances, the synthetic retailer catalogue) into
 * plain-language shapes the household surfaces can render.
 *
 * It imports no engine behaviour and mutates nothing.
 */

import { SWEEP_ITEMS } from "../sweep/fixtures";
import { shadowCatalogue } from "../procurement/fixtures";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { consumptionFixture } from "../consumption/fixtures";

export type MealState = "Cooked" | "Tonight" | "Planned" | "Leftovers";

export interface WeekDay {
  day: string;
  weekday: string;
  meal: string;
  note: string;
  state: MealState;
  /** Plain-language coverage of the ingredients for this meal. */
  coverage: "Covered" | "Needs shopping" | "Check";
}

export const householdName = "Example household · 2 adults";

export const week: readonly WeekDay[] = [
  {
    day: "Mon",
    weekday: "Monday",
    meal: "Miso butter greens & rice",
    note: "uses up the pak choi",
    state: "Cooked",
    coverage: "Covered",
  },
  {
    day: "Tue",
    weekday: "Tuesday",
    meal: "Roast salmon, new potatoes",
    note: "salmon came off the count automatically",
    state: "Cooked",
    coverage: "Covered",
  },
  {
    day: "Wed",
    weekday: "Wednesday",
    meal: "Chickpea & tomato stew",
    note: "cupboard only — nothing to buy",
    state: "Tonight",
    coverage: "Covered",
  },
  {
    day: "Thu",
    weekday: "Thursday",
    meal: "Leftover stew + flatbread",
    note: "planned leftovers, not shopped twice",
    state: "Leftovers",
    coverage: "Covered",
  },
  {
    day: "Fri",
    weekday: "Friday",
    meal: "Pizza night",
    note: "household ritual",
    state: "Planned",
    coverage: "Covered",
  },
  {
    day: "Sat",
    weekday: "Saturday",
    meal: "Slow lamb ragù",
    note: "batch cook — freezes 2 portions",
    state: "Planned",
    coverage: "Check",
  },
  {
    day: "Sun",
    weekday: "Sunday",
    meal: "Big breakfast",
    note: "oats, milk and eggs needed",
    state: "Planned",
    coverage: "Needs shopping",
  },
] as const;

export const tonight = week.find((d) => d.state === "Tonight") ?? week[0]!;

/* ------------------------------------------------------------------ *
 * Food — household-readable stock, derived from existing fixtures.
 * ------------------------------------------------------------------ */

export type StockBand = "USE_SOON" | "PLENTY" | "CHECK";

export interface PantryItem {
  itemKey: string;
  label: string;
  quantity: number;
  unit: string;
  band: StockBand;
  /** Plain-language reason, no engine terminology. */
  because: string;
  where: "Fridge" | "Cupboard" | "Freezer";
}

const LABELS: Record<string, string> = {
  "oats-rolled": "Rolled oats",
  "milk-whole": "Whole milk",
  "rice-basmati": "Basmati rice",
  "ice-cream-tub": "Ice cream",
  "eggs-large": "Large eggs",
  "flour-plain": "Plain flour",
  "coffee-beans": "Coffee beans",
};

const WHERE: Record<string, PantryItem["where"]> = {
  "oats-rolled": "Cupboard",
  "milk-whole": "Fridge",
  "rice-basmati": "Cupboard",
  "ice-cream-tub": "Freezer",
  "salmon-fillet": "Fridge",
  "gem-lettuce": "Fridge",
  haribo: "Cupboard",
};

const openingFromPlan = (consumptionFixture.openingEvents ?? []).map((event) => {
  const payload = event.payload as { quantity?: number; unit?: string } | undefined;
  return {
    itemKey: event.itemKey,
    quantity: Number(payload?.quantity ?? 0),
    unit: String(payload?.unit ?? ""),
  };
});

function band(itemKey: string, quantity: number, unit: string): StockBand {
  const target = shadowTargets.find((t) => t.itemKey === itemKey && t.unit === unit);
  if (!target) return quantity > 0 ? "PLENTY" : "CHECK";
  const ratio = quantity / target.targetQuantity;
  if (ratio < 0.4) return "USE_SOON";
  return "PLENTY";
}

export const pantry: readonly PantryItem[] = [
  ...openingFromPlan.map((row) => ({
    itemKey: row.itemKey,
    label: LABELS[row.itemKey] ?? row.itemKey,
    quantity: row.quantity,
    unit: row.unit,
    band: band(row.itemKey, row.quantity, row.unit),
    because:
      band(row.itemKey, row.quantity, row.unit) === "USE_SOON"
        ? "Below what this week's meals expect"
        : "Comfortably ahead of this week's meals",
    where: WHERE[row.itemKey] ?? "Cupboard",
  })),
  ...SWEEP_ITEMS.map((item) => ({
    itemKey: item.itemKey,
    label: item.label,
    quantity: item.openingQuantity,
    unit: item.unit,
    band: (item.itemKey === "gem-lettuce" ? "USE_SOON" : "CHECK") as StockBand,
    because: item.expectedBecause,
    where: WHERE[item.itemKey] ?? "Fridge",
  })),
];

export const pantryBands: Array<{ band: StockBand; title: string; blurb: string }> = [
  { band: "USE_SOON", title: "Use soon", blurb: "Running low or close to its planned meal." },
  { band: "CHECK", title: "Worth a check", blurb: "FoodOS isn't certain — a quick sweep settles it." },
  { band: "PLENTY", title: "Plenty", blurb: "Ahead of what this week needs." },
];

/* ------------------------------------------------------------------ *
 * Shop — candidate basket, priced from the synthetic catalogue.
 * ------------------------------------------------------------------ */

export interface BasketLine {
  sku: string;
  name: string;
  why: string;
  packs: number;
  price: number;
}

function line(sku: string, why: string, packs: number): BasketLine {
  const entry = shadowCatalogue.find((c) => c.sku === sku)!;
  return {
    sku,
    name: entry.productName,
    why,
    packs,
    price: Number((entry.packPrice * packs).toFixed(2)),
  };
}

export const basket: readonly BasketLine[] = [
  line("SKU-OAT-1000", "Two breakfasts short this week", 1),
  line("SKU-MILK-1L", "Burn-down plus Sunday breakfast", 4),
  line("SKU-EGG-6", "Sunday big breakfast", 2),
  line("SKU-RICE-1000", "Monday rice plus a buffer", 1),
];

export const basketTotal = Number(
  basket.reduce((sum, item) => sum + item.price, 0).toFixed(2),
);

export const basketHeldBack = [
  {
    label: "Butter",
    reason: "Two matching entries disagreed, so FoodOS set it aside instead of guessing.",
  },
];

export const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);

/* ------------------------------------------------------------------ *
 * Home — what FoodOS already worked out.
 * ------------------------------------------------------------------ */

export const worked_out: readonly { title: string; detail: string }[] = [
  {
    title: "Tuesday's salmon came off the count",
    detail: "The meal was marked cooked, so 780g burned down without you typing anything.",
  },
  {
    title: "Thursday isn't shopped for twice",
    detail: "Planned leftovers are treated as a meal, not a new requirement.",
  },
  {
    title: "One uncertain item was held back",
    detail: "Butter looked ambiguous, so it was isolated rather than silently bought.",
  },
];
