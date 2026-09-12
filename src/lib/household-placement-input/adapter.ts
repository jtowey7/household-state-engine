import type {
  HouseholdPlacementInput,
  HouseholdPlacementInputOptions,
  HouseholdPlacementInputRun,
  HouseholdPlacementProposal,
} from "./types";

function fingerprint(input: HouseholdPlacementInput): string {
  return JSON.stringify({
    inputId: input.inputId,
    itemKey: input.itemKey,
    category: input.category,
    location: input.location,
    observedAt: input.observedAt,
    reportedBy: input.reportedBy,
    evidence: input.evidence,
    reason: input.reason,
    source: input.source ?? "HOUSEHOLD_PLACEMENT_INPUT",
  });
}

function propose(input: HouseholdPlacementInput): HouseholdPlacementProposal {
  return {
    inputId: input.inputId,
    itemKey: input.itemKey.trim(),
    category: input.category.trim(),
    location: input.location.trim(),
    observedAt: input.observedAt,
    reportedBy: input.reportedBy,
    evidence: input.evidence,
    reason: input.reason,
    source: input.source ?? "HOUSEHOLD_PLACEMENT_INPUT",
    recordClass: "Test",
    preview: { wouldWrite: false, target: "INVENTORY" },
    requiresHumanAuthorization: true,
    fingerprint: fingerprint(input),
  };
}

/**
 * Converts an explicit household placement observation into a TEST-only proposal.
 * This deliberately has no Airtable connector and cannot mutate Production state.
 */
export function proposeHouseholdPlacementInput(
  input: HouseholdPlacementInput,
  options: HouseholdPlacementInputOptions = {},
): HouseholdPlacementInputRun {
  const rejections: HouseholdPlacementInputRun["rejections"][number][] = [];
  const deduped: string[] = [];

  if (!input.itemKey.trim()) {
    rejections.push({ inputId: input.inputId, code: "INVALID_ITEM_KEY" });
  }
  if (!input.category.trim() || !input.location.trim()) {
    rejections.push({ inputId: input.inputId, code: "INVALID_PLACEMENT" });
  }

  if (rejections.length) {
    return { proposals: [], deduped, rejections, provenance: "TEST", productionMutation: false };
  }

  const proposal = propose(input);
  const existing = options.knownProposals?.find((known) => known.inputId === input.inputId);

  if (existing) {
    if (existing.fingerprint === proposal.fingerprint) {
      deduped.push(input.inputId);
      return { proposals: [], deduped, rejections, provenance: "TEST", productionMutation: false };
    }
    rejections.push({ inputId: input.inputId, code: "PLACEMENT_PAYLOAD_CONFLICT" });
    return { proposals: [], deduped, rejections, provenance: "TEST", productionMutation: false };
  }

  return { proposals: [proposal], deduped, rejections, provenance: "TEST", productionMutation: false };
}

export function proposeHouseholdPlacementInputs(
  inputs: readonly HouseholdPlacementInput[],
  options: HouseholdPlacementInputOptions = {},
): HouseholdPlacementInputRun {
  const proposals: HouseholdPlacementProposal[] = [];
  const deduped: string[] = [];
  const rejections: HouseholdPlacementInputRun["rejections"][number][] = [];

  for (const input of inputs) {
    const result = proposeHouseholdPlacementInput(input, options);
    proposals.push(...result.proposals);
    deduped.push(...result.deduped);
    rejections.push(...result.rejections);
  }

  return { proposals, deduped, rejections, provenance: "TEST", productionMutation: false };
}
