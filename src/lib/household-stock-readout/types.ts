/**
 * Food OS — HOUSEHOLD STOCK INPUT -> CURRENT READOUT (types).
 *
 * A presentation-facing composition seam only. It reuses the existing
 * proposal-only stock-input adapter and the existing deterministic replay:
 *   - every entry becomes a canonical Correction PROPOSAL (record class Test)
 *   - only entries the human has explicitly approved are replayed into the
 *     isolated readout snapshot
 *   - nothing here holds a connector, so no Production household mutation and
 *     no retailer I/O is expressible from this module.
 */

import type { StateSnapshot, QuantityRequirementsHandoff } from "../state-engine/types";
import type {
  StockCorrectionProposal,
  StockExceptionRejection,
} from "../inventory-exception/types";

export interface StockEntryInput {
  /** Stable identity of this household entry. Drives the proposal identity. */
  entryId: string;
  itemKey: string;
  quantity: number | string | null;
  unit: string;
  observedAt: string;
  /** Explicit human approval for THIS entry. Absent/false = proposal only. */
  approved?: boolean;
  note?: string;
}

export interface StockReadoutOptions {
  now: () => string;
  reportedBy: string;
}

export interface StockReadoutLine {
  entryId: string;
  eventId: string;
  itemKey: string;
  quantity: number;
  unit: string | null;
  approved: boolean;
  /** True when an unresolved conflict touches this item in replay. */
  blocked: boolean;
}

export interface HouseholdStockReadout {
  /** Canonical proposals for every accepted entry, approved or not. */
  proposals: readonly StockCorrectionProposal[];
  /** Entries refused fail-closed (missing quantity, unit, item, etc.). */
  rejections: readonly StockExceptionRejection[];
  /** Accepted proposals still awaiting explicit human approval. */
  awaitingApproval: readonly StockCorrectionProposal[];
  /** Approved entries only, replayed in isolation. */
  snapshot: StateSnapshot;
  /** The exact input the weekly quantity/procurement run consumes. */
  handoff: QuantityRequirementsHandoff;
  /** Human-readable current stock, approved lines first. */
  lines: readonly StockReadoutLine[];
  readonly requiresHumanAuthorization: true;
  readonly productionMutation: false;
}
