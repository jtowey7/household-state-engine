export type HouseholdPlacementCategory = string;
export type HouseholdPlacementLocation = string;

/** Explicit household placement observation for a canonical inventory item. */
export interface HouseholdPlacementInput {
  inputId: string;
  itemKey: string;
  category: HouseholdPlacementCategory;
  location: HouseholdPlacementLocation;
  observedAt: string;
  reportedBy: string;
  evidence: string;
  reason: string;
  source?: string;
}

export interface HouseholdPlacementProposal {
  inputId: string;
  itemKey: string;
  category: HouseholdPlacementCategory;
  location: HouseholdPlacementLocation;
  observedAt: string;
  reportedBy: string;
  evidence: string;
  reason: string;
  source: string;
  recordClass: "Test";
  preview: {
    wouldWrite: false;
    target: "INVENTORY";
  };
  requiresHumanAuthorization: true;
  fingerprint: string;
}

export interface HouseholdPlacementInputOptions {
  knownProposals?: readonly HouseholdPlacementProposal[];
}

export interface HouseholdPlacementInputRun {
  proposals: readonly HouseholdPlacementProposal[];
  deduped: readonly string[];
  rejections: readonly { inputId: string; code: "INVALID_ITEM_KEY" | "INVALID_PLACEMENT" | "PLACEMENT_PAYLOAD_CONFLICT" }[];
  provenance: "TEST";
  productionMutation: false;
}
