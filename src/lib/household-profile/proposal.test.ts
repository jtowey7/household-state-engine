import { describe, expect, it } from "vitest";

import { buildProfileProposals, canPersistProfileProposal, type OnboardingDraftInput } from "./proposal";

const draft: OnboardingDraftInput = {
  people: "6",
  equipment: ["Oven", "Air fryer"],
  constraints: ["Allergy / medical need", "Foods we avoid"],
  constraintNote: "no peanuts",
  interests: ["Quick family meals"],
  shoppingCadence: "Once a week",
  seasonal: ["Christmas", "Summer / lighter food"],
  recurring: ["Busy school nights", "Regular takeaway night"],
};

describe("household profile proposal boundary", () => {
  it("maps only recurring and seasonal profile facts", () => {
    const proposals = buildProfileProposals(draft);
    expect(proposals.map((proposal) => proposal.preference)).toEqual([
      "Busy school nights",
      "Regular takeaway night",
      "Christmas",
      "Summer / lighter food",
      "Allergy / medical need",
    ]);
    expect(proposals.every((proposal) => proposal.source === "HOUSEHOLD_ONBOARDING")).toBe(true);
  });

  it("does not promote interests, equipment, cadence, or ad-hoc avoidance notes as preferences", () => {
    const proposals = buildProfileProposals({
      ...draft,
      constraints: ["Foods we avoid"],
    });
    expect(proposals).toHaveLength(4);
    expect(proposals.some((proposal) => proposal.preference.includes("Quick family meals"))).toBe(false);
    expect(proposals.some((proposal) => proposal.preference.includes("Air fryer"))).toBe(false);
    expect(proposals.some((proposal) => proposal.preference.includes("Once a week"))).toBe(false);
  });

  it("treats a medical/allergy detail as a critical recurring constraint", () => {
    const proposal = buildProfileProposals(draft).find((item) => item.category === "Dietary");
    expect(proposal).toMatchObject({
      importance: "Critical",
      stance: "REQUIRE",
      seasonal: false,
      detail: "no peanuts",
    });
  });

  it("requires explicit confirmation but never grants persistence authority", () => {
    const proposal = buildProfileProposals(draft)[0];
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.productionMutation).toBe(false);
    expect(canPersistProfileProposal(proposal, false)).toBe(false);
    expect(canPersistProfileProposal(proposal, true)).toBe(false);
  });

  it("supports explicit removal/change without inventing another state model", () => {
    const proposal = {
      ...buildProfileProposals(draft)[0],
      action: "REMOVE" as const,
    };
    expect(proposal.action).toBe("REMOVE");
    expect(proposal.kind).toBe("RECURRING_PROFILE");
    expect(proposal.productionMutation).toBe(false);
  });
});
