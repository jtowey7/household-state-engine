/**
 * Food OS — the SINGLE canonical consumption-event synthesis path.
 *
 * Before this module the consumption layer constructed `HouseholdEvent`
 * ITEM_STOCK_DELTA records directly, duplicating the event synthesis that the
 * append-only write boundary already owns. Every consumption fact now flows
 * through one seam:
 *
 *   consumption fact -> AppendIntent -> append boundary (PROPOSE_APPEND)
 *                    -> canonical HOUSEHOLD EVENTS row -> replay event
 *
 * ACTION POLICY: routine consumption is PREPARE. This module only ever calls
 * `preview()` on the boundary, which never mutates and never writes, so a
 * production append still requires the explicit approved capability elsewhere.
 * It holds no connector and cannot reach Airtable.
 */

import { canonicaliseAppend } from "../event-writer/canonical";
import { canonicalRecordToHouseholdEvent } from "../state-engine/canonical-household-event-replay";
import { createAppendOnlyWriteBoundary } from "../write-boundary/boundary";
import type { AppendOnlyWriteBoundary } from "../write-boundary/boundary";
import type { AppendIntent, AppendResult } from "../write-boundary/types";
import type { CanonicalAppendRecord } from "../event-writer/types";
import type { HouseholdEvent, RecordClass } from "../state-engine/types";

/** What produced the consumption fact. Part of the event's stable identity. */
export type ConsumptionSourceKind = "CONSUME" | "ALLOC" | "EXC" | "LEFTOVER";

export interface ConsumptionAppendRequest {
  kind: ConsumptionSourceKind;
  /** Meal / allocation / exception identity. */
  sourceId: string;
  itemKey: string;
  /** Positive magnitude. Direction is derived from `direction`, never guessed. */
  quantity: number;
  unit: string;
  occurredAt: string;
  /** OUT burns stock (Consumption); IN returns stock (Receipt). */
  direction: "OUT" | "IN";
  evidence: string;
  actor?: string;
  source?: string;
  confidence?: string;
  recordClass?: RecordClass;
  supersedes?: string[];
}

export interface ConsumptionAppendOptions {
  now: () => string;
  /**
   * Optional shared boundary so a whole projection run shares one journal.
   * Defaults to a fresh SIMULATION boundary — never a production capability.
   */
  boundary?: AppendOnlyWriteBoundary;
  actor?: string;
  source?: string;
  confidence?: string;
  recordClass?: RecordClass;
}

export interface ConsumptionAppendProposal {
  kind: ConsumptionSourceKind;
  sourceId: string;
  itemKey: string;
  /** `PROPOSE_APPEND` in all normal operation. Nothing is ever mutated here. */
  readonly action: "PROPOSE_APPEND";
  readonly mutated: false;
  eventId: string;
  payloadHash: string;
  intent: AppendIntent;
  record: CanonicalAppendRecord;
  /** Boundary preview outcome (SIMULATED / DUPLICATE_NOOP / CONFLICT). */
  boundaryOutcome: AppendResult["outcome"];
  event: HouseholdEvent;
}

export type ConsumptionAppendResult =
  | { ok: true; proposal: ConsumptionAppendProposal }
  | { ok: false; code: string; detail: string };

export const DEFAULT_CONSUMPTION_ACTOR = "Food OS consumption projector";
export const DEFAULT_CONSUMPTION_SOURCE = "Planned consumption projection";

/**
 * Stable identity of a consumption fact. Two different meals burning the same
 * item at the same instant stay distinct; the same meal re-evaluated collapses
 * onto one immutable Event ID, so re-delivery cannot double-decrement.
 */
export function consumptionIdentityContext(
  kind: ConsumptionSourceKind,
  sourceId: string,
  itemKey: string,
  unit: string,
): string {
  return `${kind}:${sourceId}:${itemKey}:${unit}`;
}

export function buildConsumptionAppendIntent(
  request: ConsumptionAppendRequest,
  options: ConsumptionAppendOptions,
): AppendIntent {
  const magnitude = Math.abs(request.quantity);
  return {
    eventType: request.direction === "OUT" ? "Consumption" : "Receipt",
    item: request.itemKey,
    occurredAt: request.occurredAt,
    quantityDelta: request.direction === "OUT" ? -magnitude : magnitude,
    unit: request.unit,
    source: request.source ?? options.source ?? DEFAULT_CONSUMPTION_SOURCE,
    actor: request.actor ?? options.actor ?? DEFAULT_CONSUMPTION_ACTOR,
    entityType: "Inventory item",
    evidence: request.evidence,
    confidence: request.confidence ?? options.confidence ?? "High",
    recordClass: request.recordClass ?? options.recordClass ?? "Production",
    identityContext: consumptionIdentityContext(
      request.kind,
      request.sourceId,
      request.itemKey,
      request.unit,
    ),
    ...(request.supersedes && request.supersedes.length > 0
      ? { supersedes: request.supersedes }
      : {}),
  };
}

/**
 * Proposes one consumption append and returns the replay event derived from the
 * canonical row. Never writes; the boundary is only previewed.
 */
export function proposeConsumptionAppend(
  request: ConsumptionAppendRequest,
  options: ConsumptionAppendOptions,
): ConsumptionAppendResult {
  const intent = buildConsumptionAppendIntent(request, options);
  const boundary = options.boundary ?? createAppendOnlyWriteBoundary({ now: options.now });

  const previewed = boundary.preview(intent);
  if (previewed.outcome === "REJECTED" || previewed.preview === null) {
    return {
      ok: false,
      code: previewed.rejection?.code ?? "APPEND_BOUNDARY_REJECTED",
      detail:
        previewed.rejection?.detail ??
        "The append boundary refused this consumption intent; no event was synthesised.",
    };
  }
  if (previewed.outcome === "CONFLICT") {
    return {
      ok: false,
      code: previewed.rejection?.code ?? "REUSED_EVENT_ID_PAYLOAD_CONFLICT",
      detail:
        previewed.rejection?.detail ??
        "Event ID identity conflict; the consumption fact is surfaced rather than collapsed.",
    };
  }

  const canonical = canonicaliseAppend(intent, { now: options.now });
  if (!canonical.ok) {
    return { ok: false, code: canonical.rejection.code, detail: canonical.rejection.detail };
  }

  const mapped = canonicalRecordToHouseholdEvent(canonical.record);
  if (!mapped.ok) return { ok: false, code: mapped.code, detail: mapped.detail };

  return {
    ok: true,
    proposal: {
      kind: request.kind,
      sourceId: request.sourceId,
      itemKey: request.itemKey,
      action: "PROPOSE_APPEND",
      mutated: false,
      eventId: canonical.record.eventId,
      payloadHash: canonical.record.payloadHash,
      intent,
      record: canonical.record,
      boundaryOutcome: previewed.outcome,
      event: mapped.event,
    },
  };
}
