/**
 * Deterministic drafting of a HOUSEHOLD EVENTS row from an append intent.
 *
 * Nothing here writes anywhere. It validates the intent against the real
 * contract and produces the exact row that WOULD be appended, plus the
 * immutable Event ID derived from the canonical payload.
 */

import { hashOf } from "../state-engine/hash";
import type {
  AirtableEventType,
  AppendIntent,
  AppendPreview,
  HouseholdEventRowDraft,
  WriteRejection,
} from "./types";

const INBOUND: AirtableEventType[] = ["Delivery", "Receipt"];
const OUTBOUND: AirtableEventType[] = ["Consumption", "Disposal"];
const NON_STOCK: AirtableEventType[] = [
  "Confirmation",
  "Transfer",
  "Substitution",
  "Unavailable",
  "Other",
];

export type DraftResult =
  | { ok: true; preview: AppendPreview }
  | { ok: false; rejection: WriteRejection };

function slug(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function reject(code: WriteRejection["code"], detail: string): DraftResult {
  return { ok: false, rejection: { code, detail } };
}

/**
 * The canonical identity payload normally includes `Occurred at`. A scoped
 * identityContext can instead represent the stable identity of a fact whose
 * timestamp is an observation time, while the emitted row still preserves the
 * actual `Occurred at` value.
 */
export interface CanonicalWritePayload {
  eventType: AirtableEventType;
  item: string;
  occurredAt: string;
  identityContext?: string;
  quantityDelta: number | null;
  stateAfter: number | null;
  unit: string | null;
  recordClass: string;
  supersedes: string[];
}

export function canonicalWritePayload(intent: AppendIntent): CanonicalWritePayload {
  return {
    eventType: intent.eventType,
    item: intent.item.trim(),
    occurredAt: intent.identityContext ? "" : intent.occurredAt,
    ...(intent.identityContext ? { identityContext: intent.identityContext } : {}),
    quantityDelta: intent.quantityDelta ?? null,
    stateAfter: intent.stateAfter ?? null,
    unit: intent.unit ?? null,
    recordClass: intent.recordClass,
    supersedes: [...(intent.supersedes ?? [])].sort(),
  };
}

export function deriveEventId(intent: AppendIntent): string {
  const payload = canonicalWritePayload(intent);
  const day = payload.occurredAt ? payload.occurredAt.slice(0, 10) : "IDENTITY";
  const prefix = intent.recordClass === "Test" ? "TEST" : "EVT";
  return `${prefix}-${day}-${slug(payload.item)}-${payload.eventType.toUpperCase()}-${hashOf(payload).slice(0, 8)}`;
}

export interface DraftOptions {
  /** Clock for `Recorded at`. Injected so drafts stay testable. */
  now: () => string;
  tableLabel?: string;
  /** Recorded in provenance when a production capability authorised the row. */
  approvalReference?: string | null;
}

/** Validates an intent and renders the exact row that would be appended. */
export function draftEventRow(intent: AppendIntent, options: DraftOptions): DraftResult {
  if (intent.recordClass !== "Production" && intent.recordClass !== "Test") {
    return reject("INVALID_RECORD_CLASS", "`Record class` must be Production or Test.");
  }
  if (NON_STOCK.includes(intent.eventType)) {
    return reject(
      "UNSUPPORTED_EVENT_TYPE",
      `\`${intent.eventType}\` carries no deterministic stock meaning; the append boundary will not emit it as state.`,
    );
  }
  if (!INBOUND.includes(intent.eventType) && !OUTBOUND.includes(intent.eventType) && intent.eventType !== "Correction") {
    return reject("UNSUPPORTED_EVENT_TYPE", `Unknown \`Event type\` "${intent.eventType}".`);
  }
  const item = intent.item?.trim();
  if (!item) return reject("MISSING_ITEM", "Intent has no `Item`.");
  if (!intent.occurredAt?.trim()) {
    return reject("MISSING_OCCURRED_AT", "Intent has no `Occurred at`.");
  }
  if (!intent.evidence?.trim()) {
    return reject(
      "MISSING_EVIDENCE",
      "Every appended household event must carry `Evidence`; unevidenced state changes are refused.",
    );
  }
  if (!intent.source?.trim() || !intent.actor?.trim()) {
    return reject("MISSING_ACTOR_OR_SOURCE", "Intent must declare both `Source` and `Actor`.");
  }
  if (intent.identityContext !== undefined && !intent.identityContext.trim()) {
    return reject("MISSING_EVIDENCE", "A supplied identity context must be non-empty.");
  }

  const unit = intent.unit?.trim() || null;
  let quantityDelta: number | null = null;
  let stateAfter: number | null = null;

  if (intent.eventType === "Correction") {
    if (typeof intent.stateAfter !== "number" || !Number.isFinite(intent.stateAfter)) {
      return reject(
        "UNMAPPABLE_CORRECTION",
        "A Correction must supply an unambiguous numeric `State after`; quantities are never invented.",
      );
    }
    if (intent.stateAfter < 0) {
      return reject("UNMAPPABLE_CORRECTION", "`State after` cannot be negative.");
    }
    if (!unit) return reject("MISSING_UNIT", "A Correction with `State after` must supply `Unit`.");
    stateAfter = intent.stateAfter;
  } else {
    if (typeof intent.quantityDelta !== "number" || !Number.isFinite(intent.quantityDelta)) {
      return reject(
        "MISSING_QUANTITY_DELTA",
        `${intent.eventType} requires a numeric \`Quantity delta\`; quantities are never invented.`,
      );
    }
    if (intent.quantityDelta === 0) {
      return reject("MISSING_QUANTITY_DELTA", "A zero `Quantity delta` carries no state change.");
    }
    if (!unit) return reject("MISSING_UNIT", `${intent.eventType} requires a \`Unit\`.`);
    if (INBOUND.includes(intent.eventType) && intent.quantityDelta < 0) {
      return reject(
        "QUANTITY_DIRECTION_CONFLICT",
        `${intent.eventType} cannot reduce stock; the sign is not flipped.`,
      );
    }
    if (OUTBOUND.includes(intent.eventType) && intent.quantityDelta > 0) {
      return reject(
        "QUANTITY_DIRECTION_CONFLICT",
        `${intent.eventType} must carry a negative \`Quantity delta\`; the sign is not flipped for you.`,
      );
    }
    quantityDelta = intent.quantityDelta;
  }

  const normalised: AppendIntent = { ...intent, item, unit: unit ?? undefined };
  const eventId = deriveEventId(normalised);
  if (intent.eventId && intent.eventId !== eventId) {
    return reject(
      "EVENT_ID_MISMATCH",
      `Supplied Event ID "${intent.eventId}" does not match the identity derived from this payload ("${eventId}"); an Event ID cannot be re-pointed at a different payload.`,
    );
  }

  const supersedes = [...(intent.supersedes ?? [])];
  const approvalNote = options.approvalReference
    ? ` | approval:${options.approvalReference}`
    : "";

  const row: HouseholdEventRowDraft = {
    "Event ID": eventId,
    "Event type": intent.eventType,
    "Occurred at": intent.occurredAt,
    "Recorded at": options.now(),
    Source: intent.source,
    Actor: intent.actor,
    "Entity type": intent.entityType ?? "Inventory item",
    "Entity reference": intent.entityReference ?? "",
    Item: item,
    "Quantity delta": quantityDelta,
    Unit: unit,
    Evidence: `${intent.evidence}${approvalNote}`,
    "State before": typeof intent.stateBefore === "number" ? String(intent.stateBefore) : "",
    "State after": stateAfter === null ? "" : String(stateAfter),
    Confidence: intent.confidence ?? "High",
    "Supersedes event ID": supersedes,
    "Exception / reconciliation action": intent.exceptionAction ?? "",
    "Replay status": "Pending",
    "Record class": intent.recordClass,
  };

  return {
    ok: true,
    preview: {
      eventId,
      payloadHash: hashOf(canonicalWritePayload(normalised)),
      row,
      request: {
        method: "POST",
        tableLabel: options.tableLabel ?? "HOUSEHOLD EVENTS",
        body: { records: [{ fields: row }] },
      },
    },
  };
}
