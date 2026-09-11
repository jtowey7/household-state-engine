/**
 * Consumer household-profile proposal boundary.
 *
 * Proposal-only: this module maps the small onboarding vocabulary onto the
 * existing HOUSEHOLD/PREFERENCES concepts. It performs no Airtable I/O and
 * cannot persist, remove, or mutate Production state. A later governed action
 * may consume a proposal only after explicit confirmation.
 */

export type ProfileFactKind = "RECURRING_PROFILE" | "SEASONAL_PROFILE";
export type ProfileAction = "ADD" | "CHANGE" | "REMOVE";
export type PreferenceStance = "FAVOUR" | "AVOID" | "REQUIRE" | "CONTEXT";

export interface HouseholdProfileProposal {
  proposalId: string;
  kind: ProfileFactKind;
  action: ProfileAction;
  preference: string;
  category: "Favourite" | "Like" | "Dislike" | "Dietary" | "Meal" | "Tradition";
  importance: "Critical" | "High" | "Normal" | "Low";
  person?: string;
  stance: PreferenceStance;
  seasonal: boolean;
  detail?: string;
  source: "HOUSEHOLD_ONBOARDING";
  requiresConfirmation: true;
  productionMutation: false;
}

export interface OnboardingDraftInput {
  people: string;
  equipment: string[];
  constraints: string[];
  constraintNote: string;
  interests: string[];
  shoppingCadence: string;
  seasonal: string[];
  recurring: string[];
}

const recurringMap: Record<string, Omit<HouseholdProfileProposal, "proposalId" | "preference" | "detail">> = {
  "Busy school nights": {
    kind: "RECURRING_PROFILE",
    action: "ADD",
    category: "Tradition",
    importance: "Normal",
    stance: "CONTEXT",
    seasonal: false,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Regular takeaway night": {
    kind: "RECURRING_PROFILE",
    action: "ADD",
    category: "Meal",
    importance: "Normal",
    stance: "CONTEXT",
    seasonal: false,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Weekend cooking": {
    kind: "RECURRING_PROFILE",
    action: "ADD",
    category: "Tradition",
    importance: "Normal",
    stance: "FAVOUR",
    seasonal: false,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Guests fairly often": {
    kind: "RECURRING_PROFILE",
    action: "ADD",
    category: "Tradition",
    importance: "Normal",
    stance: "CONTEXT",
    seasonal: false,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
};

const seasonalMap: Record<string, Omit<HouseholdProfileProposal, "proposalId" | "preference" | "detail">> = {
  Christmas: {
    kind: "SEASONAL_PROFILE",
    action: "ADD",
    category: "Tradition",
    importance: "Normal",
    stance: "CONTEXT",
    seasonal: true,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Pancake Day": {
    kind: "SEASONAL_PROFILE",
    action: "ADD",
    category: "Tradition",
    importance: "Normal",
    stance: "CONTEXT",
    seasonal: true,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Summer / lighter food": {
    kind: "SEASONAL_PROFILE",
    action: "ADD",
    category: "Meal",
    importance: "Normal",
    stance: "FAVOUR",
    seasonal: true,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
  "Winter / hearty food": {
    kind: "SEASONAL_PROFILE",
    action: "ADD",
    category: "Meal",
    importance: "Normal",
    stance: "FAVOUR",
    seasonal: true,
    source: "HOUSEHOLD_ONBOARDING",
    requiresConfirmation: true,
    productionMutation: false,
  },
};

function proposalId(kind: ProfileFactKind, value: string): string {
  return `onboarding:${kind}:${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function baseProposal(
  value: string,
  map: Omit<HouseholdProfileProposal, "proposalId" | "preference" | "detail">,
  detail?: string,
): HouseholdProfileProposal {
  return { ...map, proposalId: proposalId(map.kind, value), preference: value, detail };
}

/**
 * Converts only the recurring/seasonal portion of onboarding into explicit
 * proposals. Ad-hoc events and free-form notes are deliberately not promoted.
 */
export function buildProfileProposals(input: OnboardingDraftInput): HouseholdProfileProposal[] {
  const proposals: HouseholdProfileProposal[] = [];

  for (const value of input.recurring) {
    const mapped = recurringMap[value];
    if (mapped) proposals.push(baseProposal(value, mapped));
  }

  for (const value of input.seasonal) {
    const mapped = seasonalMap[value];
    if (mapped) proposals.push(baseProposal(value, mapped));
  }

  const note = input.constraintNote.trim();
  if (note && input.constraints.includes("Allergy / medical need")) {
    proposals.push(
      baseProposal("Allergy / medical need", {
        kind: "RECURRING_PROFILE",
        action: "ADD",
        category: "Dietary",
        importance: "Critical",
        stance: "REQUIRE",
        seasonal: false,
        source: "HOUSEHOLD_ONBOARDING",
        requiresConfirmation: true,
        productionMutation: false,
      }, note),
    );
  }

  return proposals;
}

export function canPersistProfileProposal(proposal: HouseholdProfileProposal, confirmed: boolean): boolean {
  return proposal.requiresConfirmation && confirmed === true && proposal.productionMutation === false;
}
