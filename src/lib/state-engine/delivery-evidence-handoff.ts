import { canonicaliseAppend } from "../event-writer/canonical";
import type { CanonicalAppendRecord } from "../event-writer/types";
import { buildHumanDeliveryEvidenceAppendIntents } from "./delivery-evidence-ledger";
import { verifyHumanDeliveryEvidence } from "./delivery-evidence";
import type { HumanDeliveryEvidence } from "./delivery-evidence";
import type { HouseholdEvent } from "./types";

export type DeliveryEvidenceHandoffResult =
  | { ok: true; records: CanonicalAppendRecord[]; events: HouseholdEvent[] }
  | { ok: false; code: "INVALID_EVIDENCE" | "CANONICALISATION_FAILED"; detail: string };

/**
 * Runtime/operator boundary for sealed human delivery evidence.
 *
 * The handoff verifies the sealed envelope, maps it through the existing
 * evidence->HOUSEHOLD EVENTS intent builder, and obtains canonical append
 * records plus the equivalent replay events. It deliberately stops before
 * any connector append: human authority is still required before Production
 * persistence.
 */
export function prepareDeliveryEvidenceHandoff(
  evidence: HumanDeliveryEvidence,
  now: () => string = () => evidence.capturedAt,
): DeliveryEvidenceHandoffResult {
  if (!verifyHumanDeliveryEvidence(evidence)) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Delivery evidence failed integrity verification." };
  }

  const intents = buildHumanDeliveryEvidenceAppendIntents(evidence);
  if (!intents.ok) return intents;

  const records: CanonicalAppendRecord[] = [];
  const events: HouseholdEvent[] = [];
  for (const intent of intents.intents) {
    const canonical = canonicaliseAppend(intent, { now });
    if (!canonical.ok) {
      return {
        ok: false,
        code: "CANONICALISATION_FAILED",
        detail: `${canonical.rejection.code}: ${canonical.rejection.detail}`,
      };
    }
    records.push(canonical.record);
    const row = canonical.record.row;
    if (row["Event type"] !== "Delivery" || row["Quantity delta"] === null || row["Quantity delta"] <= 0 || !row.Item || !row.Unit) {
      return {
        ok: false,
        code: "CANONICALISATION_FAILED",
        detail: `Canonical delivery event ${canonical.record.eventId} cannot be replayed as a positive stock delta.`,
      };
    }
    events.push({
      eventId: canonical.record.eventId,
      recordClass: row["Record class"],
      eventType: "ITEM_STOCK_DELTA",
      itemKey: row.Item,
      occurredAt: row["Occurred at"],
      payload: {
        quantity: row["Quantity delta"],
        unit: row.Unit,
        note: row.Evidence,
        evidencePrecision: "EXACT",
      },
    });
  }

  return { ok: true, records, events };
}
