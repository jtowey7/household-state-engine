/**
 * PROPOSE_APPEND: turns projected household events into canonical append
 * proposals for human review.
 *
 * This is the PREPARE half of the ACTION POLICY. It produces canonical records
 * and PROPOSED receipts; it holds no connector and cannot write. Nothing here
 * dispatches, and nothing here touches INVENTORY.
 */

import type { HouseholdEvent } from "../state-engine/types";
import type { AppendIntent } from "../write-boundary/types";
import { canonicaliseAppend } from "./canonical";
import { createHouseholdEventWriter } from "./writer";
import type { AppendReceipt, CanonicalAppendRecord } from "./types";
import type { WriteRejection } from "../write-boundary/types";

export interface AppendProposal {
  /** Source event from the consumption projection. */
  sourceEventId: string;
  record: CanonicalAppendRecord | null;
  receipt: AppendReceipt | null;
  rejection: WriteRejection | null;
  /** Always true: a proposal is never a write. */
  readonly requiresHumanAuthorization: true;
}

export interface ProposeOptions {
  now: () => string;
  /** Event IDs already present in the source; never re-proposed. */
  existingEventIds?: readonly string[];
  actor?: string;
  source?: string;
}

/** Maps one canonical projected event to an append intent. */
export function intentForProjectedEvent(
  event: HouseholdEvent,
  options: { actor: string; source: string },
): AppendIntent | null {
  const quantity = event.payload.quantity;
  const unit = event.payload.unit;
  if (typeof quantity !== "number" || !unit) return null;

  const base = {
    item: event.itemKey,
    occurredAt: event.occurredAt,
    unit,
    source: options.source,
    actor: options.actor,
    entityType: "Inventory item",
    evidence: event.payload.note ?? `projected:${event.eventId}`,
    confidence: "High",
    recordClass: event.recordClass,
    ...(event.supersedes ? { supersedes: event.supersedes } : {}),
  };

  if (event.eventType === "ITEM_STOCK_SET") {
    return { ...base, eventType: "Correction", stateAfter: quantity };
  }
  if (event.eventType === "ITEM_STOCK_DELTA") {
    if (quantity === 0) return null;
    return {
      ...base,
      eventType: quantity < 0 ? "Consumption" : "Receipt",
      quantityDelta: quantity,
    };
  }
  return null;
}

export function proposeAppends(
  events: readonly HouseholdEvent[],
  options: ProposeOptions,
): AppendProposal[] {
  const existing = new Set(options.existingEventIds ?? []);
  // A PROPOSE-mode writer with no port: structurally unable to write.
  const writer = createHouseholdEventWriter({ mode: "PROPOSE" });
  const proposals: AppendProposal[] = [];

  for (const event of events) {
    if (existing.has(event.eventId)) continue;
    const intent = intentForProjectedEvent(event, {
      actor: options.actor ?? "Food OS state engine",
      source: options.source ?? "Planned meal completion (shadow cycle)",
    });
    if (!intent) {
      proposals.push({
        sourceEventId: event.eventId,
        record: null,
        receipt: null,
        rejection: {
          code: "UNSUPPORTED_EVENT_TYPE",
          detail: `${event.eventType} carries no appendable quantity+unit; no row is proposed.`,
        },
        requiresHumanAuthorization: true,
      });
      continue;
    }
    const canonical = canonicaliseAppend(intent, { now: options.now });
    if (!canonical.ok) {
      proposals.push({
        sourceEventId: event.eventId,
        record: null,
        receipt: null,
        rejection: canonical.rejection,
        requiresHumanAuthorization: true,
      });
      continue;
    }
    proposals.push({
      sourceEventId: event.eventId,
      record: canonical.record,
      receipt: writer.propose(canonical.record),
      rejection: null,
      requiresHumanAuthorization: true,
    });
  }

  return proposals;
}
