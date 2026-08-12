/**
 * PREPARE / PREVIEW half of the append seam.
 *
 * `prepareAppend` validates an intent against the real HOUSEHOLD EVENTS
 * contract (event type, sign, item/unit/quantity, immutable Event ID, Record
 * class, provenance/evidence, supersession) and renders the EXACT row that
 * would be appended.
 *
 * `previewAppend` is the human-facing view of that: it carries
 * `wouldWrite: false`, holds no port, and is structurally incapable of
 * calling a connector — there is no port parameter anywhere in this module.
 */

import type { AppendIntent, AppendPreview, WriteRejection } from "../write-boundary/types";
import { canonicaliseAppend } from "./canonical";
import type { CanonicalAppendRecord } from "./types";

export interface PreparedAppend {
  record: CanonicalAppendRecord;
  /** Immutable Event ID, derived from the canonical payload. */
  eventId: string;
  payloadHash: string;
  /** The exact Airtable-shaped row + request body that WOULD be sent. */
  preview: AppendPreview;
  /** Always false. Preparation never writes. */
  readonly wouldWrite: false;
  /** Every append requires an explicit human authorization first. */
  readonly requiresHumanAuthorization: true;
}

export type PrepareAppendResult =
  | { ok: true; prepared: PreparedAppend }
  | { ok: false; rejection: WriteRejection };

export interface PrepareOptions {
  /** Clock for `Recorded at`. Injected so previews stay deterministic. */
  now: () => string;
}

export function prepareAppend(
  intent: AppendIntent,
  options: PrepareOptions,
): PrepareAppendResult {
  const canonical = canonicaliseAppend(intent, { now: options.now });
  if (!canonical.ok) return { ok: false, rejection: canonical.rejection };

  const record = canonical.record;
  return {
    ok: true,
    prepared: {
      record,
      eventId: record.eventId,
      payloadHash: record.payloadHash,
      preview: {
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        row: record.row,
        request: {
          method: "POST",
          tableLabel: "HOUSEHOLD EVENTS",
          body: { records: [{ fields: record.row }] },
        },
      },
      wouldWrite: false,
      requiresHumanAuthorization: true,
    },
  };
}

/** Convenience view: the row a human reviews before authorising anything. */
export function previewAppend(
  intent: AppendIntent,
  options: PrepareOptions,
): PrepareAppendResult {
  return prepareAppend(intent, options);
}

/** Preview for an already-canonical record (e.g. one produced by PROPOSE). */
export function previewOfRecord(record: CanonicalAppendRecord): PreparedAppend {
  return {
    record,
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    preview: {
      eventId: record.eventId,
      payloadHash: record.payloadHash,
      row: record.row,
      request: {
        method: "POST",
        tableLabel: "HOUSEHOLD EVENTS",
        body: { records: [{ fields: record.row }] },
      },
    },
    wouldWrite: false,
    requiresHumanAuthorization: true,
  };
}
