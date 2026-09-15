import { describe, expect, it } from "vitest";

import { projectConsumptionEvents } from "../consumption/projector";
import { describeCycle } from "../household-view/cycle-state";
import {
  createMemoryMealPlanPort,
  deterministicMealProvider,
  persistSelectedWeek,
  selectMeals,
  validateMealCandidates,
  type MealCandidate,
  type MealGenerationRequest,
} from "./index";

const request: MealGenerationRequest = {
  weekStartIso: "2026-09-14",
  mealCount: 5,
  people: 4,
  constraints: [],
};

describe("zero-meal discoverability", () => {
  it("offers a way to plan the week when nothing is planned", () => {
    const view = describeCycle({
      shopReady: false,
      shopApproved: false,
      deliveryKnown: false,
      deliveryApproved: false,
      receiptConfirmed: false,
      planExists: false,
    });
    expect(view.stage).toBe("WEEK_NOT_PLANNED");
    expect(view.action).toEqual({ label: "Plan this week", to: "/plan-week" });
  });

  it("does not offer planning once the week already has meals", () => {
    const view = describeCycle({
      shopReady: false,
      shopApproved: false,
      deliveryKnown: false,
      deliveryApproved: false,
      receiptConfirmed: false,
      planExists: true,
    });
    expect(view.action.to).not.toBe("/plan-week");
  });
});

describe("deterministic candidate generation", () => {
  it("is deterministic and bounded to seven meals", () => {
    const a = deterministicMealProvider.generate({ ...request, mealCount: 9 });
    const b = deterministicMealProvider.generate({ ...request, mealCount: 9 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
  });

  it("scales amounts by the number of people and applies broad constraints", () => {
    const veg = deterministicMealProvider.generate({ ...request, constraints: ["vegetarian"] });
    expect(veg.length).toBe(5);
    for (const candidate of veg) {
      expect(candidate.components.every((component) => component.quantity > 0)).toBe(true);
    }
    const one = deterministicMealProvider.generate({ ...request, people: 1, constraints: ["vegetarian"] });
    expect(veg[0]!.components[0]!.quantity).toBe(one[0]!.components[0]!.quantity * 4);
  });
});

describe("candidate validation is fail-closed", () => {
  it("accepts a clean generated week", () => {
    const result = validateMealCandidates(deterministicMealProvider.generate(request), request);
    expect(result.ok).toBe(true);
  });

  it("refuses unreadable amounts, unknown measures, missing days and duplicates", () => {
    const base = deterministicMealProvider.generate(request)[0]!;
    const bad: MealCandidate[][] = [
      [{ ...base, components: [{ itemKey: "Rice", quantity: 0, unit: "g" }] }],
      [{ ...base, components: [{ itemKey: "Rice", quantity: 2, unit: "handfuls" }] }],
      [{ ...base, plannedFor: "not-a-day" }],
      [{ ...base, plannedFor: "2026-10-30" }],
      [{ ...base, label: "  " }],
      [base, { ...base, candidateId: "other" }],
      [],
    ];
    for (const candidates of bad) {
      const result = validateMealCandidates(candidates, request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const refusal of result.refusals) {
          expect(refusal.reason).not.toMatch(/MISSING_|CANONICAL|payload|event id|contract/i);
        }
      }
    }
  });
});

describe("selected-plan-only persistence", () => {
  it("persists only the meals the household kept", async () => {
    const candidates = deterministicMealProvider.generate(request);
    const selected = selectMeals(candidates, [candidates[0]!.candidateId, candidates[3]!.candidateId], 4);
    const port = createMemoryMealPlanPort();
    const result = await persistSelectedWeek(selected, port);

    expect(result.ok).toBe(true);
    expect(port.rows).toHaveLength(2);
    expect(port.rows.map((row) => row.Meal)).toEqual([candidates[0]!.label, candidates[3]!.label]);
    expect(port.rows.every((row) => row.Status === "Planned")).toBe(true);
  });

  it("refuses to save an empty week", async () => {
    const port = createMemoryMealPlanPort();
    const result = await persistSelectedWeek([], port);
    expect(result.ok).toBe(false);
    expect(port.rows).toHaveLength(0);
  });

  it("writes nothing when the persistence path fails", async () => {
    const candidates = deterministicMealProvider.generate(request);
    const selected = selectMeals(candidates, [candidates[0]!.candidateId], 4);
    const result = await persistSelectedWeek(selected, {
      async appendPlannedMeals() {
        throw new Error("port down");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Nothing has been changed/);
  });
});

describe("a planned meal never burns stock", () => {
  it("produces no consumption events for meals scheduled in the future", () => {
    const candidates = deterministicMealProvider.generate(request);
    const selected = selectMeals(candidates, candidates.map((candidate) => candidate.candidateId), 4);
    const projection = projectConsumptionEvents(
      {
        meals: selected.map((meal) => ({
          mealId: meal.candidateId,
          plannedFor: `${meal.plannedFor}T18:00:00.000Z`,
          state: "PLANNED" as const,
          components: [...meal.components],
        })),
      },
      { asOf: "2026-09-13T00:00:00.000Z" },
    );
    expect(projection.events).toHaveLength(0);
  });
});
