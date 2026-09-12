/**
 * Food OS — STOCK ENTRY -> EXACT APPROVAL REQUEST (presentation seam).
 *
 * Reuses the existing `household-input` intake module to show, for a household
 * stock entry, the exact human authority the protected writer would demand.
 * It owns no connector and never appends: `prepareHouseholdIntake()` only ever
 * PROPOSES, and the returned request carries no decision and no approver, so it
 * can never satisfy the writer on its own.
 */

import { prepareHouseholdIntake } from "../household-input/intake";
import type { IntakeApprovalRequest } from "../household-input/types";
import type { StockEntryInput, StockReadoutOptions } from "./types";

export interface StockApprovalBoundaryLine {
  entryId: string;
  itemKey: string;
  /** Present when the entry is canonicalisable. */
  request: IntakeApprovalRequest | null;
  /** Present when the entry was refused fail-closed. */
  refusal: string | null;
}

export interface StockApprovalBoundary {
  lines: readonly StockApprovalBoundaryLine[];
  readonly requiresHumanAuthorization: true;
  readonly productionMutation: false;
}

/**
 * Describe the approval boundary for each entry. Entries the human has already
 * confirmed are included too: confirmation in this surface is a local readout
 * decision, not authority to write to the household record.
 */
export function describeStockApprovalBoundary(
  entries: readonly StockEntryInput[],
  options: StockReadoutOptions,
): StockApprovalBoundary {
  const lines: StockApprovalBoundaryLine[] = entries.map((entry) => {
    const prepared = prepareHouseholdIntake(
      {
        kind: "STOCK_CORRECTION",
        report: {
          exceptionId: entry.entryId,
          itemKey: entry.itemKey,
          statedStateAfter: entry.quantity,
          unit: entry.unit,
          observedAt: entry.observedAt,
          reportedBy: options.reportedBy,
          source: "HOUSEHOLD_STOCK_INPUT",
          evidence: entry.note?.trim()
            ? entry.note.trim()
            : `Counted by ${options.reportedBy} at ${entry.observedAt}.`,
          confidence: "High",
          reason: "Household stock count",
          recordClass: "Test",
        },
      },
      { now: options.now },
    );

    if (!prepared.ok) {
      return {
        entryId: entry.entryId,
        itemKey: entry.itemKey,
        request: null,
        refusal: prepared.detail,
      };
    }

    return {
      entryId: entry.entryId,
      itemKey: entry.itemKey,
      request: prepared.approvalRequests[0] ?? null,
      refusal: null,
    };
  });

  return { lines, requiresHumanAuthorization: true, productionMutation: false };
}
