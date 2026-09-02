import type { AppendIntent } from "../write-boundary/types";
import type { HumanDeliveryEvidence } from "./delivery-evidence";

export type DeliveryEvidenceLedgerIntentResult =
  | { ok: true; intents: AppendIntent[] }
  | { ok: false; code: "INVALID_EVIDENCE"; detail: string };

/**
 * Bind a sealed human delivery envelope to the existing HOUSEHOLD EVENTS
 * append boundary. This creates caller intents only; it does not write,
 * approve, dispatch or mutate Production state.
 *
 * Each delivered line becomes one positive Delivery event. The envelope's
 * evidenceId/digest and exact dispatch/basket provenance are retained in the
 * evidence field, while identityContext makes the Event ID stable for the
 * delivery line rather than for the observation timestamp.
 */
export function buildHumanDeliveryEvidenceAppendIntents(
  evidence: HumanDeliveryEvidence,
): DeliveryEvidenceLedgerIntentResult {
  if (evidence.provenance !== "HUMAN_RECORDED_PURCHASE_DELIVERY") {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Unsupported delivery evidence provenance." };
  }
  if (!evidence.evidenceId || !evidence.digest || !evidence.basketId || !evidence.orderReference || !evidence.retailer) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Sealed delivery evidence is missing durable identity fields." };
  }
  if (evidence.delivery.reconciliationStatus !== "RECONCILED") {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Only RECONCILED delivery evidence may enter the household event ledger." };
  }
  if (evidence.delivery.lines.length === 0) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Reconciled delivery evidence must contain at least one line." };
  }

  const intents: AppendIntent[] = [];
  for (const line of evidence.delivery.lines) {
    if (!line.lineId.trim() || !line.itemKey.trim()) {
      return { ok: false, code: "INVALID_EVIDENCE", detail: "Every delivery line requires lineId and itemKey." };
    }
    if (!Number.isFinite(line.deliveredQuantity) || line.deliveredQuantity < 0) {
      return { ok: false, code: "INVALID_EVIDENCE", detail: `Invalid delivered quantity for line ${line.lineId}.` };
    }
    if (line.deliveredQuantity === 0) continue;
    const unit = typeof line.unit === "string" ? line.unit.trim() : "";
    if (!unit) {
      return { ok: false, code: "INVALID_EVIDENCE", detail: `Delivered line ${line.lineId} has no unit; refusing to invent one.` };
    }

    const evidencePayload = JSON.stringify({
      evidenceId: evidence.evidenceId,
      evidenceDigest: evidence.digest,
      basketId: evidence.basketId,
      orderReference: evidence.orderReference,
      retailer: evidence.retailer,
      deliveryId: evidence.delivery.deliveryId,
      dispatchId: evidence.delivery.dispatchId,
      basketVersion: evidence.delivery.basketVersion,
      basketFingerprint: evidence.delivery.basketFingerprint,
      lineId: line.lineId,
      substituted: line.substituted === true,
    });

    intents.push({
      eventType: "Delivery",
      item: line.itemKey,
      occurredAt: evidence.delivery.deliveredAt,
      quantityDelta: line.deliveredQuantity,
      unit,
      source: "HUMAN_RECORDED_PURCHASE_DELIVERY",
      actor: evidence.capturedBy,
      entityType: "Delivery evidence",
      entityReference: evidence.evidenceId,
      evidence: evidencePayload,
      confidence: "High",
      recordClass: "Production",
      identityContext: `${evidence.evidenceId}:line:${line.lineId}`,
    });
  }

  if (intents.length === 0) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Delivery evidence contains no positive stock-changing lines." };
  }

  return { ok: true, intents };
}
