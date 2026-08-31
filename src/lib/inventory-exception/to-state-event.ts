/**
 * Food OS — accepted stock input -> State Engine event.
 *
 * This is the smallest join between the already-accepted household stock/input
 * boundary and the existing canonical State Engine. It consumes a canonical
 * Correction proposal only and emits a TEST-only ITEM_STOCK_SET event.
 *
 * There is deliberately no Airtable port, no INVENTORY write and no Production
 * capability here. The resulting event is suitable for the existing isolated
 * runtime adapter and can therefore exercise real replay/materialisation
 * semantics without changing household Production state.
 */

import type { CanonicalAppendRecord } from "../event-writer/types";
import { isCanonicalAppendRecord } from "../event-writer/canonical";
import type { HouseholdEvent } from "../state-engine/types";
import type { StockCorrectionProposal } from "./types";

export type StockInputStateEventResult =
  | { ok: true; event: HouseholdEvent }
  | { ok: false; code: "NON_CANONICAL_PROPOSAL" | "PRODUCTION_PROPOSAL"; detail: string };

function canonicalRecordOf(proposal: StockCorrectionProposal): CanonicalAppendRecord | null {
  return isCanonicalAppendRecord(proposal.record) ? proposal.record : null;
}

/**
 * Convert one accepted Correction proposal into the existing State Engine
 * representation. The conversion is intentionally one-way and TEST-only.
 */
export function stockCorrectionToTestStateEvent(
  proposal: StockCorrectionProposal,
): StockInputStateEventResult {
  const canonical = canonicalRecordOf(proposal);
  if (!canonical) {
    return {
      ok: false,
      code: "NON_CANONICAL_PROPOSAL",
      detail: "Stock input must carry a canonical HOUSEHOLD EVENTS append record.",
    };
  }

  if (proposal.recordClass !== "Test" || canonical.row["Record class"] !== "Test") {
    return {
      ok: false,
      code: "PRODUCTION_PROPOSAL",
      detail: "Stock input -> State Engine projection is TEST-only; Production proposals are refused.",
    };
  }

  const event: HouseholdEvent = {
    eventId: canonical.eventId,
    recordClass: "Test",
    eventType: "ITEM_STOCK_SET",
    itemKey: proposal.itemKey,
    occurredAt: proposal.occurredAt,
    payload: {
      quantity: proposal.stateAfter,
      unit: proposal.unit,
      note: proposal.reason,
      evidencePrecision: "EXACT",
    },
    ...(proposal.intent.supersedes && proposal.intent.supersedes.length > 0
      ? { supersedes: [...proposal.intent.supersedes].sort() }
      : {}),
  };

  return { ok: true, event };
}
