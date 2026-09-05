import { proposeHouseholdStockInputs } from "../household-stock-input/adapter";
import type { StockCorrectionProposal } from "../inventory-exception/types";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { HouseholdEvent } from "../state-engine/types";
import type {
  HouseholdStockReadout,
  StockEntryInput,
  StockReadoutLine,
  StockReadoutOptions,
} from "./types";

/**
 * Turn explicit household stock entries into canonical proposals and, for the
 * entries a human has explicitly approved, an isolated current-stock readout
 * plus the existing QUANTITY REQUIREMENTS handoff.
 *
 * Unapproved entries never reach the snapshot: no approval, no state.
 */
export function buildHouseholdStockReadout(
  entries: readonly StockEntryInput[],
  options: StockReadoutOptions,
): HouseholdStockReadout {
  const run = proposeHouseholdStockInputs(
    entries.map((entry) => ({
      inputId: entry.entryId,
      itemKey: entry.itemKey,
      quantity: entry.quantity,
      unit: entry.unit,
      observedAt: entry.observedAt,
      reportedBy: options.reportedBy,
      evidence: entry.note?.trim()
        ? entry.note.trim()
        : `Counted by ${options.reportedBy} at ${entry.observedAt}.`,
      reason: "Household stock count",
    })),
    { now: options.now },
  );

  const approvedEntryIds = new Set(
    entries.filter((entry) => entry.approved === true).map((entry) => entry.entryId),
  );

  const approved: StockCorrectionProposal[] = [];
  const awaiting: StockCorrectionProposal[] = [];
  for (const proposal of run.proposals) {
    if (approvedEntryIds.has(proposal.exceptionId)) approved.push(proposal);
    else awaiting.push(proposal);
  }

  // Isolated replay input. These events exist only in memory for this readout;
  // the canonical Test-class proposals above remain the only writable artefact.
  const replayInput: HouseholdEvent[] = approved.map((proposal) => ({
    eventId: proposal.eventId,
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: proposal.itemKey,
    occurredAt: proposal.occurredAt,
    payload: { quantity: proposal.stateAfter, unit: proposal.unit, evidencePrecision: "EXACT" },
  }));

  const snapshot = replayEvents(replayInput, { now: options.now });
  const handoff = toQuantityRequirementsHandoff(snapshot);

  const byItem = new Map(snapshot.items.map((item) => [item.itemKey, item]));
  const lines: StockReadoutLine[] = approved.map((proposal) => {
    const item = byItem.get(proposal.itemKey);
    return {
      entryId: proposal.exceptionId,
      eventId: proposal.eventId,
      itemKey: proposal.itemKey,
      quantity: item ? item.quantity : proposal.stateAfter,
      unit: item ? item.unit : proposal.unit,
      approved: true,
      blocked: item ? item.blocked : false,
    };
  });
  for (const proposal of awaiting) {
    lines.push({
      entryId: proposal.exceptionId,
      eventId: proposal.eventId,
      itemKey: proposal.itemKey,
      quantity: proposal.stateAfter,
      unit: proposal.unit,
      approved: false,
      blocked: false,
    });
  }

  return {
    proposals: run.proposals,
    rejections: run.rejections,
    awaitingApproval: awaiting,
    snapshot,
    handoff,
    lines,
    requiresHumanAuthorization: true,
    productionMutation: false,
  };
}
