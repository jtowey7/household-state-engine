/**
 * Canonicalisation: the only way to obtain a `CanonicalAppendRecord`.
 *
 * It reuses the proven drafting/validation path so the write seam and the
 * read seam agree on one field contract and one identity derivation. Callers
 * never construct identity, and an object that has not passed validation
 * cannot be handed to the writer.
 */

import { draftEventRow } from "../write-boundary/draft";
import type { AppendIntent, WriteRejection } from "../write-boundary/types";
import type { CanonicalAppendRecord } from "./types";

export type CanonicaliseResult =
  | { ok: true; record: CanonicalAppendRecord }
  | { ok: false; rejection: WriteRejection };

export interface CanonicaliseOptions {
  /** Clock for `Recorded at`. Injected so records stay deterministic. */
  now: () => string;
  /** Recorded into provenance when an approval already exists. */
  approvalReference?: string | null;
}

/**
 * Canonical records are an in-memory capability, not a structural DTO. A
 * caller cannot manufacture the private WeakSet membership, and the returned
 * object is frozen so an authorised record cannot be mutated after creation.
 * This closes the gap between the structural marker and the documented claim
 * that canonical records can only be obtained through `canonicaliseAppend()`.
 */
const canonicalRecords = new WeakSet<object>();

function freezeCanonicalRecord(record: CanonicalAppendRecord): CanonicalAppendRecord {
  Object.freeze(record.row["Supersedes event ID"]);
  Object.freeze(record.row);
  Object.freeze(record);
  canonicalRecords.add(record);
  return record;
}

export function canonicaliseAppend(
  intent: AppendIntent,
  options: CanonicaliseOptions,
): CanonicaliseResult {
  const draft = draftEventRow(intent, {
    now: options.now,
    tableLabel: "HOUSEHOLD EVENTS",
    approvalReference: options.approvalReference ?? null,
  });
  if (!draft.ok) return { ok: false, rejection: draft.rejection };
  return {
    ok: true,
    record: freezeCanonicalRecord({
      eventId: draft.preview.eventId,
      payloadHash: draft.preview.payloadHash,
      row: draft.preview.row,
      __canonical: "HOUSEHOLD_EVENTS",
    }),
  };
}

/** Structural check used by the writer before it trusts a record. */
export function isCanonicalAppendRecord(value: unknown): value is CanonicalAppendRecord {
  if (typeof value !== "object" || value === null || !canonicalRecords.has(value)) return false;
  const r = value as Partial<CanonicalAppendRecord>;
  return (
    r.__canonical === "HOUSEHOLD_EVENTS" &&
    typeof r.eventId === "string" &&
    r.eventId.length > 0 &&
    typeof r.payloadHash === "string" &&
    r.payloadHash.length > 0 &&
    typeof r.row === "object" &&
    r.row !== null &&
    typeof (r.row as { "Event ID"?: unknown })["Event ID"] === "string" &&
    (r.row as { "Event ID"?: unknown })["Event ID"] === r.eventId
  );
}
