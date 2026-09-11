/**
 * Food OS — planned meal -> completion decision -> canonical consumption
 * proposal -> deterministic replay -> materialised state, inside the shadow
 * weekly cycle.
 *
 * The write path stays PROPOSE-only: every assertion below also proves the
 * cycle mutated no household state and appended nothing.
 */

import { describe, it, expect } from "vitest";
import { runShadowHouseholdCycle } from "../shadow-household/shadow-run";
import { SALMON } from "../shadow-household/case";
import type { PlannedMealCompletion } from "../meal-completion/types";

/** Only the meal completion drives consumption in these runs. */
const emptyPlan = {};

function completion(over: Partial<PlannedMealCompletion> = {}): PlannedMealCompletion {
  return {
    mealId: "MEAL-2026-08-11-DINNER",
    completionId: "CMP-2026-08-11-DINNER-1",
    mealPlanId: "PLAN-2026-W33",
    recipeId: "RCP-SALMON-TRAYBAKE",
    mealName: "Salmon traybake",
    plannedFor: "2026-08-11T18:30:00.000Z",
    completedAt: "2026-08-11T19:15:00.000Z",
    state: "COMPLETED",
    ingredients: [{ itemKey: SALMON, quantity: 780, unit: "g" }],
    ...over,
  };
}

function salmonQuantity(run: Awaited<ReturnType<typeof runShadowHouseholdCycle>>) {
  return run.snapshot?.items.find((i) => i.itemKey === SALMON)?.quantity ?? null;
}

describe("shadow weekly cycle: meal completion reaches materialised state", () => {
  it("completed salmon dinner proposes exactly one -780g Consumption and replays to 0g", async () => {
    const run = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: [completion()],
    });

    expect(run.mealProposals?.proposals).toHaveLength(1);
    const proposal = run.mealProposals!.proposals[0]!;
    expect(proposal.record.row["Event type"]).toBe("Consumption");
    expect(proposal.record.row["Quantity delta"]).toBe(-780);
    expect(proposal.requiresHumanAuthorization).toBe(true);

    // The SAME canonical row drives replay.
    expect(salmonQuantity(run)).toBe(0);
    expect(
      run.snapshot?.items.find((i) => i.itemKey === SALMON)?.contributingEventIds,
    ).toContain(proposal.eventId);

    // Proposal-only.
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.appendedEvents).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.appendProposals.every((p) => p.requiresHumanAuthorization)).toBe(true);
  });

  it("repeated hourly evaluation cannot consume the same stock twice", async () => {
    const completions = [completion()];
    const first = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: completions,
    });
    const second = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: completions,
      knownMealProposals: first.mealProposals!.fingerprints,
    });

    expect(second.mealProposals?.proposals).toHaveLength(0);
    expect(second.mealProposals?.deduped).toHaveLength(1);
    // Not -780 again: the item floors at the single canonical consumption.
    expect(salmonQuantity(second)).toBe(780);
    expect(second.appendedEvents).toBe(false);

    // A third identical evaluation is byte-identical to the second.
    const third = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: completions,
      knownMealProposals: first.mealProposals!.fingerprints,
    });
    expect(third.appendProposals.map((p) => p.record?.eventId)).toEqual(
      second.appendProposals.map((p) => p.record?.eventId),
    );
  });

  it("a skipped meal never consumes stock in the materialised state", async () => {
    const run = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: [completion({ state: "SKIPPED" })],
    });
    expect(run.mealProposals?.proposals).toHaveLength(0);
    expect(salmonQuantity(run)).toBe(780);
  });

  it("a changed meal awaits its replacement rather than consuming", async () => {
    const run = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: [
        completion({ state: "CHANGED", replacedByCompletionId: "CMP-2026-08-11-DINNER-2" }),
      ],
    });
    expect(run.mealProposals?.proposals).toHaveLength(0);
    expect(run.mealProposals?.exceptions.map((e) => e.code)).toContain(
      "MEAL_CHANGED_AWAITING_REPLACEMENT",
    );
    expect(salmonQuantity(run)).toBe(780);
  });

  it("an ambiguous quantity isolates that item and leaves the rest planning", async () => {
    const run = await runShadowHouseholdCycle({
      plan: emptyPlan,
      mealCompletions: [
        completion({
          ingredients: [
            { itemKey: SALMON, quantity: null, unit: "g" },
            { itemKey: "Kerrygold Butter 250G", quantity: 50, unit: "g" },
          ],
        }),
      ],
    });
    expect(run.mealProposals?.exceptions.map((e) => e.code)).toContain("MISSING_QUANTITY");
    expect(run.mealProposals?.proposals.map((p) => p.itemKey)).toEqual([
      "Kerrygold Butter 250G",
    ]);
    expect(salmonQuantity(run)).toBe(780);
  });
});
