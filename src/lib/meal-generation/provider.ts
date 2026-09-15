/**
 * Deterministic in-repo meal candidate provider.
 *
 * Same request in, same candidates out. It invents no external dependency and
 * no household data: it draws from a small fixed repertoire and scales
 * component quantities by the stated number of people.
 */

import type { PlannedComponent } from "../consumption/types";
import type { MealCandidate, MealGenerationProvider, MealGenerationRequest } from "./types";

interface RepertoireMeal {
  key: string;
  label: string;
  why: string;
  tags: readonly string[];
  /** Per-person amounts; scaled by the requested people count. */
  perPerson: readonly PlannedComponent[];
}

export const MEAL_REPERTOIRE: readonly RepertoireMeal[] = [
  {
    key: "chicken-traybake",
    label: "Chicken traybake",
    why: "One tray, little washing up.",
    tags: ["chicken", "meat"],
    perPerson: [
      { itemKey: "Chicken thighs", quantity: 200, unit: "g" },
      { itemKey: "Potatoes", quantity: 250, unit: "g" },
      { itemKey: "Peppers", quantity: 1, unit: "unit" },
    ],
  },
  {
    key: "veg-chilli",
    label: "Veg chilli and rice",
    why: "Cheap, filling, good the next day.",
    tags: ["vegetarian"],
    perPerson: [
      { itemKey: "Kidney beans", quantity: 1, unit: "can" },
      { itemKey: "Chopped tomatoes", quantity: 1, unit: "can" },
      { itemKey: "Rice", quantity: 75, unit: "g" },
    ],
  },
  {
    key: "salmon-greens",
    label: "Salmon with greens",
    why: "Quick midweek, on the table in twenty minutes.",
    tags: ["fish"],
    perPerson: [
      { itemKey: "Salmon fillets", quantity: 130, unit: "g" },
      { itemKey: "Green beans", quantity: 120, unit: "g" },
      { itemKey: "Potatoes", quantity: 200, unit: "g" },
    ],
  },
  {
    key: "pasta-pesto",
    label: "Pasta with pesto",
    why: "Store cupboard standby for a busy evening.",
    tags: ["vegetarian"],
    perPerson: [
      { itemKey: "Pasta", quantity: 100, unit: "g" },
      { itemKey: "Pesto", quantity: 40, unit: "g" },
    ],
  },
  {
    key: "beef-mince-bolognese",
    label: "Bolognese",
    why: "A family favourite that scales easily.",
    tags: ["beef", "meat"],
    perPerson: [
      { itemKey: "Beef mince", quantity: 125, unit: "g" },
      { itemKey: "Chopped tomatoes", quantity: 1, unit: "can" },
      { itemKey: "Spaghetti", quantity: 100, unit: "g" },
    ],
  },
  {
    key: "lentil-soup",
    label: "Lentil soup and bread",
    why: "Warming and uses what is usually in already.",
    tags: ["vegetarian"],
    perPerson: [
      { itemKey: "Red lentils", quantity: 80, unit: "g" },
      { itemKey: "Carrots", quantity: 100, unit: "g" },
      { itemKey: "Bread", quantity: 1, unit: "pack" },
    ],
  },
  {
    key: "roast-veg-couscous",
    label: "Roast veg couscous",
    why: "Good use of vegetables before they turn.",
    tags: ["vegetarian"],
    perPerson: [
      { itemKey: "Courgette", quantity: 1, unit: "unit" },
      { itemKey: "Peppers", quantity: 1, unit: "unit" },
      { itemKey: "Couscous", quantity: 80, unit: "g" },
    ],
  },
  {
    key: "fish-pie",
    label: "Fish pie",
    why: "A slower Sunday meal with leftovers.",
    tags: ["fish"],
    perPerson: [
      { itemKey: "White fish", quantity: 150, unit: "g" },
      { itemKey: "Potatoes", quantity: 250, unit: "g" },
      { itemKey: "Milk", quantity: 150, unit: "ml" },
    ],
  },
  {
    key: "chicken-curry",
    label: "Chicken curry",
    why: "Makes enough for a second night.",
    tags: ["chicken", "meat"],
    perPerson: [
      { itemKey: "Chicken breast", quantity: 160, unit: "g" },
      { itemKey: "Coconut milk", quantity: 1, unit: "can" },
      { itemKey: "Rice", quantity: 75, unit: "g" },
    ],
  },
  {
    key: "jacket-potatoes",
    label: "Jacket potatoes and beans",
    why: "Almost no effort on a busy night.",
    tags: ["vegetarian"],
    perPerson: [
      { itemKey: "Potatoes", quantity: 300, unit: "g" },
      { itemKey: "Baked beans", quantity: 1, unit: "can" },
      { itemKey: "Cheddar", quantity: 40, unit: "g" },
    ],
  },
];

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedFrom(request: MealGenerationRequest): number {
  const source = `${request.weekStartIso}|${(request.constraints ?? []).join(",")}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 100000;
  }
  return hash;
}

function excludedTags(constraints: readonly string[]): Set<string> {
  const excluded = new Set<string>();
  for (const raw of constraints) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (value.includes("vegetarian") || value.includes("no meat")) {
      excluded.add("meat");
      excluded.add("chicken");
      excluded.add("beef");
      excluded.add("fish");
    }
    if (value.includes("no fish") || value.includes("fish free")) excluded.add("fish");
    if (value.includes("no beef")) excluded.add("beef");
    if (value.includes("no chicken")) excluded.add("chicken");
  }
  return excluded;
}

function scale(perPerson: readonly { itemKey: string; quantity: number; unit: string }[], people: number) {
  return perPerson.map((component) => ({
    itemKey: component.itemKey,
    quantity: Math.round(component.quantity * people * 100) / 100,
    unit: component.unit,
  }));
}

/**
 * Deterministic demo/test provider. It proposes candidates only: the household
 * still chooses what is kept, and nothing is written here.
 */
export const deterministicMealProvider: MealGenerationProvider = {
  id: "deterministic-repertoire-v1",
  generate(request: MealGenerationRequest): MealCandidate[] {
    const people = Math.max(1, Math.floor(request.people));
    const wanted = Math.min(7, Math.max(0, Math.floor(request.mealCount)));
    if (wanted === 0) return [];

    const excluded = excludedTags(request.constraints ?? []);
    const pool = MEAL_REPERTOIRE.filter((meal) => !meal.tags.some((tag) => excluded.has(tag)));
    if (pool.length === 0) return [];

    const start = seedFrom(request) % pool.length;
    const candidates: MealCandidate[] = [];
    for (let index = 0; index < wanted; index += 1) {
      const meal = pool[(start + index) % pool.length]!;
      candidates.push({
        candidateId: `${meal.key}-${index}`,
        label: meal.label,
        plannedFor: addDays(request.weekStartIso, index),
        why: meal.why,
        components: scale(meal.perPerson, people),
      });
    }
    return candidates;
  },
};
