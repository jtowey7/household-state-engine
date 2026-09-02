import { canonicaliseAppend } from "../event-writer/canonical";
import type { CanonicalAppendRecord } from "../event-writer/types";
import { buildHumanDeliveryEvidenceAppendIntents } from "./delivery-evidence-ledger";
import { verifyHumanDeliveryEvidence } from "./delivery-evidence";
import type { HumanDeliveryEvidence } from "./delivery-evidence";

export type DeliveryEvidenceHandoffResult =
  | { ok: true; records: CanonicalAppendRecord[] }
  | { ok: false; code: "INVALID_EVIDENCE" | "CANONICALISATION_FAILED"; detail: string };

/**
 * Runtime/operator boundary for sealed human delivery evidence.
 *
 * The handoff verifies the sealed envelope, maps it through the existing
 * evidence->HOUSEHOLD EVENTS intent builder, and obtains canonical append
 * records. It deliberately stops before any connector append: human authority
 * is still required before Production persistence.
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
  }

  return { ok: true, records };
}
