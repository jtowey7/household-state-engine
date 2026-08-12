/**
 * Food OS — USER-REPORTED INVENTORY EXCEPTION -> CANONICAL CORRECTION PROPOSAL
 * (types).
 *
 * Boundary: a human says "the salmon is actually 0g". This seam turns that
 * explicit report into a `Correction` `AppendIntent` on the EXISTING canonical
 * writer path (`canonicaliseAppend` / `prepareAppend`). It invents no second
 * event schema, holds no connector, and can never write Airtable or mutate
 * INVENTORY. Every output is a preview with `wouldWrite: false`.
 */

import type { CanonicalAppendRecord } from "../event-writer/types";
import type { PreparedAppend } from "../event-writer/preview";
import type { AppendIntent } from "../write-boundary/types";
import type { RecordClass } from "../state-engine/types";

/**
 * An explicit user-reported stock exception. The stated state-after is what
 * the human actually said; it is never inferred and never coerced.
 *
 * `statedStateAfter` accepts a non-number only so an ambiguous report ("about
 * half a pack") can be REFUSED rather than silently parsed.
 */
export interface UserReportedStockException {
  /** Stable identity of THIS report. Drives dedupe across evaluations. */
  exceptionId: string;
  itemKey: string;
  /** The absolute quantity the user stated is on hand. */
  statedStateAfter?: number | string | null;
  unit?: string | null;
  /** When the user observed the state. */
  observedAt: string;
  /** Human who reported it. Required — the runtime never self-reports. */
  reportedBy?: string;
  source?: string;
  /** Explicit user evidence. Required; an unevidenced report is refused. */
  evidence?: string;
  confidence?: string;
  /** Exception / reconciliation reason, preserved verbatim onto the row. */
  reason: string;
  /** Optional prior on-hand quantity the user is correcting away from. */
  statedStateBefore?: number | null;
  /**
   * Explicit supersession only. Supplied when the user is knowingly correcting
   * a prior event; supersession is never inferred from the report.
   */
  supersedes?: string[];
  recordClass?: RecordClass;
}

export type StockExceptionCode =
  | "MISSING_ITEM"
  | "MISSING_OCCURRED_AT"
  | "MISSING_QUANTITY"
  | "AMBIGUOUS_QUANTITY"
  | "INVALID_QUANTITY"
  | "MISSING_UNIT"
  | "MISSING_EVIDENCE"
  | "MISSING_ACTOR_OR_SOURCE"
  | "MISSING_REASON"
  | "CANONICALISATION_REJECTED"
  | "EXCEPTION_PAYLOAD_CONFLICT"
  | "EXCEPTION_PROVENANCE_CONFLICT";

export interface StockExceptionRejection {
  code: StockExceptionCode;
  exceptionId: string;
  itemKey: string | null;
  detail: string;
}

/** Stable fingerprint of one user-reported exception proposal. */
export interface StockExceptionFingerprint {
  /** `exception::${exceptionId}::${itemKey}` — dedupe key across runs. */
  proposalKey: string;
  eventId: string;
  payloadHash: string;
  /** Hash of the preserved provenance/evidence fields. */
  provenanceHash: string;
}

export interface StockCorrectionProposal extends StockExceptionFingerprint {
  exceptionId: string;
  itemKey: string;
  stateAfter: number;
  unit: string;
  occurredAt: string;
  reason: string;
  recordClass: RecordClass;
  intent: AppendIntent;
  record: CanonicalAppendRecord;
  /** Preview only: `wouldWrite: false`, no port anywhere. */
  preview: PreparedAppend;
  readonly requiresHumanAuthorization: true;
}

export interface StockExceptionProposalRun {
  proposals: StockCorrectionProposal[];
  /** Suppressed because an identical proposal already exists. */
  deduped: StockExceptionFingerprint[];
  rejections: StockExceptionRejection[];
  /** Every fingerprint known after this run — feed back on the next run. */
  fingerprints: StockExceptionFingerprint[];
}

export interface StockExceptionProposalOptions {
  now: () => string;
  /** Fingerprints from earlier evaluations of the same exception queue. */
  knownProposals?: readonly StockExceptionFingerprint[];
  actor?: string;
  source?: string;
  confidence?: string;
  recordClass?: RecordClass;
  allowedUnits?: readonly string[];
}
