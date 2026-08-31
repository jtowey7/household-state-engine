import type { StockExceptionFingerprint, StockExceptionProposalRun, StockCorrectionProposal } from "../inventory-exception/types";

/** Explicit household observation used to correct on-hand stock in a safe test path. */
export interface HouseholdStockInput {
  inputId: string;
  itemKey: string;
  quantity: number | string | null;
  unit: string;
  observedAt: string;
  reportedBy: string;
  evidence: string;
  reason: string;
  source?: string;
  confidence?: string;
}

export interface HouseholdStockInputOptions {
  now: () => string;
  knownProposals?: readonly StockExceptionFingerprint[];
  allowedUnits?: readonly string[];
}

export interface HouseholdStockInputRun extends StockExceptionProposalRun {
  readonly provenance: "TEST";
  readonly productionMutation: false;
}

export type HouseholdStockInputProposal = StockCorrectionProposal;
