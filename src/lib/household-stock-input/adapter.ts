import { proposeStockExceptionCorrections } from "../inventory-exception/adapter";
import type { StockExceptionFingerprint } from "../inventory-exception/types";
import type { HouseholdStockInput, HouseholdStockInputOptions, HouseholdStockInputRun } from "./types";

/**
 * Convert an explicit household stock observation into the existing canonical
 * Correction proposal path. This adapter is deliberately TEST-only: it never
 * owns a connector and never mutates INVENTORY or HOUSEHOLD EVENTS.
 */
export function proposeHouseholdStockInput(
  input: HouseholdStockInput,
  options: HouseholdStockInputOptions,
): HouseholdStockInputRun {
  const result = proposeStockExceptionCorrections(
    [
      {
        exceptionId: input.inputId,
        itemKey: input.itemKey,
        statedStateAfter: input.quantity,
        unit: input.unit,
        observedAt: input.observedAt,
        reportedBy: input.reportedBy,
        source: input.source ?? "HOUSEHOLD_STOCK_INPUT",
        evidence: input.evidence,
        confidence: input.confidence ?? "High",
        reason: input.reason,
        recordClass: "Test",
      },
    ],
    {
      now: options.now,
      knownProposals: options.knownProposals,
      allowedUnits: options.allowedUnits,
      recordClass: "Test",
    },
  );

  return {
    ...result,
    provenance: "TEST",
    productionMutation: false,
  };
}

/**
 * Evaluate a batch of explicit stock observations using the same safe,
 * proposal-only boundary. Each observation remains independently identified.
 */
export function proposeHouseholdStockInputs(
  inputs: readonly HouseholdStockInput[],
  options: HouseholdStockInputOptions,
): HouseholdStockInputRun {
  const result = proposeStockExceptionCorrections(
    inputs.map((input) => ({
      exceptionId: input.inputId,
      itemKey: input.itemKey,
      statedStateAfter: input.quantity,
      unit: input.unit,
      observedAt: input.observedAt,
      reportedBy: input.reportedBy,
      source: input.source ?? "HOUSEHOLD_STOCK_INPUT",
      evidence: input.evidence,
      confidence: input.confidence ?? "High",
      reason: input.reason,
      recordClass: "Test" as const,
    })),
    {
      now: options.now,
      knownProposals: options.knownProposals,
      allowedUnits: options.allowedUnits,
      recordClass: "Test",
    },
  );

  return {
    ...result,
    provenance: "TEST",
    productionMutation: false,
  };
}
