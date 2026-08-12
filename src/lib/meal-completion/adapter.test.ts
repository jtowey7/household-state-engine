import { describe, it, expect } from "vitest";
import { proposeMealCompletionConsumption } from "./adapter";
import type { PlannedMealCompletion } from "./types";
import { replayEvents } from "../state-engine/engine";
import { runShadowHouseholdCycle } from "../shadow-household/shadow-run";

const now = () => "2026-08-12T08:00:00.000Z";
const SALMON = "Tesco 6 Boneless Salmon Fillets 780G";

function meal(over: Partial<PlannedMealCompletion> = {}): PlannedMealCompletion {
  return {
    mealId: "MEAL-TUE-DINNER",
    completionId: "CMP-MEAL-TUE-DINNER-1",
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

describe("planned meal completion -> canonical consumption proposal", () => {
  it("normal one-item completed meal proposes exactly one Consumption row", () => {
    const run = proposeMealCompletionConsumption([meal()], { now });
    expect(run.proposals).toHaveLength(1);
    const p = run.proposals[0]!;
    expect(p.record.row["Event type"]).toBe("Consumption");
    expect(p.record.row["Quantity delta"]).toBe(-780);
    expect(p.record.row.Unit).toBe("g");
    expect(p.record.row["Occurred at"]).toBe("2026-08-11T19:15:00.000Z");
    expect(p.preview.wouldWrite).toBe(false);
    expect(p.requiresHumanAuthorization).toBe(true);
    // provenance preserved
    expect(p.mealPlanId).toBe("PLAN-2026-W33");
    expect(p.recipeId).toBe("RCP-SALMON-TRAYBAKE");
    expect(p.record.row.Evidence).toContain("CMP-MEAL-TUE-DINNER-1");
    expect(p.record.row.Evidence).toContain("RCP-SALMON-TRAYBAKE");
    expect(p.record.row.Confidence).toBe("High");
    expect(p.record.row["Record class"]).toBe("Production");
  });

  it("multi-item meal proposes one row per item, deterministically ordered", () => {
    const run = proposeMealCompletionConsumption(
      [
        meal({
          ingredients: [
            { itemKey: "Rice", quantity: 300, unit: "g" },
            { itemKey: SALMON, quantity: 780, unit: "g" },
            { itemKey: "Broccoli", quantity: 2, unit: "unit" },
          ],
        }),
      ],
      { now },
    );
    expect(run.proposals.map((p) => p.itemKey)).toEqual(["Broccoli", "Rice", SALMON]);
    expect(run.exceptions).toEqual([]);
  });

  it("duplicate ingredient lines aggregate deterministically before proposal", () => {
    const run = proposeMealCompletionConsumption(
      [
        meal({
          ingredients: [
            { itemKey: SALMON, quantity: 390, unit: "g" },
            { itemKey: SALMON, quantity: 390, unit: "g" },
          ],
        }),
      ],
      { now },
    );
    expect(run.proposals).toHaveLength(1);
    expect(run.proposals[0]!.quantity).toBe(780);
    expect(run.proposals[0]!.record.row["Quantity delta"]).toBe(-780);
  });

  it("repeated scheduler evaluation is idempotent: no second proposal", () => {
    const first = proposeMealCompletionConsumption([meal()], { now });
    const second = proposeMealCompletionConsumption([meal()], {
      now,
      knownProposals: first.fingerprints,
    });
    expect(second.proposals).toHaveLength(0);
    expect(second.deduped).toHaveLength(1);
    expect(second.deduped[0]!.eventId).toBe(first.proposals[0]!.eventId);
    expect(second.fingerprints).toEqual(first.fingerprints);
  });

  it("skipped and cancelled meals propose nothing", () => {
    const run = proposeMealCompletionConsumption(
      [meal({ state: "SKIPPED" }), meal({ completionId: "CMP-2", state: "CANCELLED" })],
      { now },
    );
    expect(run.proposals).toHaveLength(0);
    expect(run.exceptions.map((e) => e.code).sort()).toEqual(["MEAL_CANCELLED", "MEAL_SKIPPED"]);
  });

  it("changed meal does not silently consume the superseded plan", () => {
    const changed = meal({ state: "CHANGED", replacedByCompletionId: "CMP-MEAL-TUE-DINNER-2" });
    const run = proposeMealCompletionConsumption([changed], { now });
    expect(run.proposals).toHaveLength(0);
    expect(run.exceptions[0]!.code).toBe("MEAL_CHANGED_AWAITING_REPLACEMENT");

    // The replacement completion identity drives consumption instead.
    const replacement = proposeMealCompletionConsumption(
      [meal({ completionId: "CMP-MEAL-TUE-DINNER-2", ingredients: [{ itemKey: SALMON, quantity: 400, unit: "g" }] })],
      { now },
    );
    expect(replacement.proposals).toHaveLength(1);
    expect(replacement.proposals[0]!.quantity).toBe(400);
  });

  it("missing quantity isolates the item and invents nothing", () => {
    const run = proposeMealCompletionConsumption(
      [
        meal({
          ingredients: [
            { itemKey: SALMON, unit: "g" },
            { itemKey: "Rice", quantity: 300, unit: "g" },
          ],
        }),
      ],
      { now },
    );
    expect(run.proposals.map((p) => p.itemKey)).toEqual(["Rice"]);
    expect(run.exceptions[0]).toMatchObject({ code: "MISSING_QUANTITY", itemKey: SALMON });
  });

  it("mixed or invalid units isolate the item", () => {
    const run = proposeMealCompletionConsumption(
      [
        meal({
          ingredients: [
            { itemKey: SALMON, quantity: 0.4, unit: "kg" },
            { itemKey: SALMON, quantity: 380, unit: "g" },
            { itemKey: "Rice", quantity: 300, unit: "cups" },
          ],
        }),
      ],
      { now },
    );
    expect(run.proposals).toHaveLength(0);
    expect(run.exceptions.map((e) => e.code).sort()).toEqual(["MISSING_UNIT", "UNIT_MISMATCH"]);
  });

  it("two meals on the same day produce two distinct proposals", () => {
    const lunch = meal({
      mealId: "MEAL-TUE-LUNCH",
      completionId: "CMP-TUE-LUNCH-1",
      completedAt: "2026-08-11T12:30:00.000Z",
      ingredients: [{ itemKey: SALMON, quantity: 200, unit: "g" }],
    });
    const run = proposeMealCompletionConsumption([lunch, meal()], { now });
    expect(run.proposals).toHaveLength(2);
    expect(new Set(run.proposals.map((p) => p.eventId)).size).toBe(2);
  });

  it("changed quantity surfaces a conflict instead of collapsing into the old proposal", () => {
    const first = proposeMealCompletionConsumption([meal()], { now });
    const changed = proposeMealCompletionConsumption(
      [meal({ ingredients: [{ itemKey: SALMON, quantity: 500, unit: "g" }] })],
      { now, knownProposals: first.fingerprints },
    );
    expect(changed.proposals).toHaveLength(0);
    expect(changed.exceptions[0]!.code).toBe("PROPOSAL_PAYLOAD_CONFLICT");
  });

  it("changed provenance surfaces a conflict instead of silent dedupe", () => {
    const first = proposeMealCompletionConsumption([meal()], { now });
    const reprovenanced = proposeMealCompletionConsumption([meal({ recipeId: "RCP-OTHER" })], {
      now,
      knownProposals: first.fingerprints,
    });
    expect(reprovenanced.proposals).toHaveLength(0);
    expect(reprovenanced.exceptions[0]!.code).toBe("PROPOSAL_PROVENANCE_CONFLICT");
  });

  it("completion after a partial/exception state carries supersession through", () => {
    const run = proposeMealCompletionConsumption(
      [meal({ completionId: "CMP-AFTER-PARTIAL", supersedes: ["EVT-2026-08-11-PARTIAL"] })],
      { now },
    );
    const p = run.proposals[0]!;
    expect(p.record.row["Supersedes event ID"]).toEqual(["EVT-2026-08-11-PARTIAL"]);
    // Identity differs from the non-superseding proposal: supersession is canonical.
    const plain = proposeMealCompletionConsumption([meal({ completionId: "CMP-AFTER-PARTIAL" })], { now });
    expect(p.eventId).not.toBe(plain.proposals[0]!.eventId);
  });

  it("salmon: 780g opening + proposed consumption replays to 0g", () => {
    const run = proposeMealCompletionConsumption([meal()], { now });
    const consumption = run.proposals[0]!;
    const snapshot = replayEvents(
      [
        {
          eventId: "EVT-2026-08-11-SALMON-DELIVERY",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: SALMON,
          occurredAt: "2026-08-11T08:30:00.000Z",
          recordClass: "Production",
          payload: { quantity: 780, unit: "g", note: "Tesco delivery" },
        },
        {
          eventId: consumption.eventId,
          eventType: "ITEM_STOCK_DELTA",
          itemKey: SALMON,
          occurredAt: consumption.occurredAt,
          recordClass: "Production",
          payload: { quantity: -780, unit: "g", note: "Planned meal completion" },
        },
      ],
      { now },
    );
    expect(snapshot.items.find((i) => i.itemKey === SALMON)?.quantity).toBe(0);
  });

  it("weekly cycle: same completion across two runs yields one unique proposal, never writes", async () => {
    const completions = [meal()];
    const first = await runShadowHouseholdCycle({ mealCompletions: completions });
    expect(first.mealProposals?.proposals).toHaveLength(1);
    expect(first.mutatedHouseholdState).toBe(false);
    expect(first.appendedEvents).toBe(false);
    const eventId = first.mealProposals!.proposals[0]!.eventId;

    const second = await runShadowHouseholdCycle({
      mealCompletions: completions,
      knownMealProposals: first.mealProposals!.fingerprints,
    });
    expect(second.mealProposals?.proposals).toHaveLength(0);
    expect(second.mealProposals?.deduped[0]!.eventId).toBe(eventId);
    const ids = second.appendProposals.map((p) => p.record?.eventId).filter(Boolean);
    expect(ids.filter((id) => id === eventId)).toHaveLength(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
