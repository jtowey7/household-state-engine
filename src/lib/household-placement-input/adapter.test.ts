import { describe, expect, it } from "vitest";
import { proposeHouseholdPlacementInput, proposeHouseholdPlacementInputs } from "./adapter";

const input = {
  inputId: "placement-001",
  itemKey: "Tesco Mince 500g",
  category: "Meat",
  location: "Fridge",
  observedAt: "2026-09-11T06:50:00.000Z",
  reportedBy: "James",
  evidence: "Household placement",
  reason: "Put delivered mince in the fridge",
};

describe("household placement input boundary", () => {
  it("creates a TEST-only proposal for an explicit canonical item placement", () => {
    const result = proposeHouseholdPlacementInput(input);

    expect(result.rejections).toHaveLength(0);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      inputId: input.inputId,
      itemKey: input.itemKey,
      category: input.category,
      location: input.location,
      recordClass: "Test",
      preview: { wouldWrite: false, target: "INVENTORY" },
      requiresHumanAuthorization: true,
    });
    expect(result.productionMutation).toBe(false);
  });

  it("refuses missing canonical identity or placement rather than guessing", () => {
    const result = proposeHouseholdPlacementInput({
      ...input,
      itemKey: "",
      location: "",
    });

    expect(result.proposals).toHaveLength(0);
    expect(result.rejections.map((r) => r.code)).toEqual([
      "INVALID_ITEM_KEY",
      "INVALID_PLACEMENT",
    ]);
    expect(result.productionMutation).toBe(false);
  });

  it("deduplicates an identical repeated placement observation", () => {
    const first = proposeHouseholdPlacementInput(input);
    const second = proposeHouseholdPlacementInput(input, {
      knownProposals: first.proposals,
    });

    expect(second.proposals).toHaveLength(0);
    expect(second.deduped).toEqual([input.inputId]);
    expect(second.rejections).toHaveLength(0);
  });

  it("blocks reuse of an input ID with a different placement payload", () => {
    const first = proposeHouseholdPlacementInput(input);
    const second = proposeHouseholdPlacementInput(
      { ...input, location: "Freezer" },
      { knownProposals: first.proposals },
    );

    expect(second.proposals).toHaveLength(0);
    expect(second.rejections).toEqual([
      { inputId: input.inputId, code: "PLACEMENT_PAYLOAD_CONFLICT" },
    ]);
    expect(second.productionMutation).toBe(false);
  });

  it("keeps batch placement proposals independently traceable", () => {
    const result = proposeHouseholdPlacementInputs([
      input,
      { ...input, inputId: "placement-002", itemKey: "Tesco Milk 2L", location: "Fridge" },
    ]);

    expect(result.proposals).toHaveLength(2);
    expect(new Set(result.proposals.map((p) => p.inputId))).toEqual(
      new Set(["placement-001", "placement-002"]),
    );
    expect(result.productionMutation).toBe(false);
  });
});
