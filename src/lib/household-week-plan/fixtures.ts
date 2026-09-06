import type { PlannedWeekMeal } from "./types";

/**
 * SYNTHETIC planned meals for the household week. These are the meals the
 * household has chosen; the ingredient names deliberately match the wording a
 * household would type on the "Enter what you have" page.
 */
export const householdWeekMeals: readonly PlannedWeekMeal[] = [
  {
    mealId: "WEEK-MON",
    label: "Chicken traybake",
    plannedFor: "2026-09-07T18:30:00.000Z",
    state: "PLANNED",
    note: "one pack of chicken, rice on the side",
    components: [
      { itemKey: "Chicken breast", quantity: 1, unit: "pack" },
      { itemKey: "Basmati rice", quantity: 300, unit: "g" },
    ],
  },
  {
    mealId: "WEEK-TUE",
    label: "Rice bowls",
    plannedFor: "2026-09-08T18:30:00.000Z",
    state: "PLANNED",
    note: "uses the rest of the chicken",
    components: [
      { itemKey: "Chicken breast", quantity: 1, unit: "pack" },
      { itemKey: "Basmati rice", quantity: 400, unit: "g" },
    ],
  },
  {
    mealId: "WEEK-WED",
    label: "Big breakfast",
    plannedFor: "2026-09-09T08:00:00.000Z",
    state: "PLANNED",
    note: "eggs and oats",
    components: [
      { itemKey: "Eggs", quantity: 6, unit: "count" },
      { itemKey: "Rolled oats", quantity: 200, unit: "g" },
    ],
  },
];
