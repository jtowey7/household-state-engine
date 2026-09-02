import { hashOf } from "./hash";
import type { ReconciledDelivery } from "./delivery-inventory";

/**
 * Durable handoff produced from a human-recorded purchase/delivery outcome.
 *
 * This is intentionally a pure validation/sealing seam. It does not write
 * Airtable, mutate household state, approve anything, or contact a retailer.
 * The envelope binds the externally recorded outcome to the basket/order the
 * human says it belongs to, so later reconciliation cannot silently drift to a
 * different purchase.
 */
export interface HumanDeliveryEvidenceInput {
  basketId: string;
  orderReference: string;
  retailer: string;
  capturedAt: string;
  capturedBy: string;
  delivery: ReconciledDelivery;
  evidenceNote?: string;
}

export interface HumanDeliveryEvidence {
  evidenceId: string;
  basketId: string;
  orderReference: string;
  retailer: string;
  capturedAt: string;
  capturedBy: string;
  delivery: ReconciledDelivery;
  evidenceNote: string | null;
  provenance: "HUMAN_RECORDED_PURCHASE_DELIVERY";
  digest: string;
}

export type DeliveryEvidenceValidation =
  | { ok: true; evidence: HumanDeliveryEvidence }
  | { ok: false; code: "INVALID_EVIDENCE"; detail: string };

function required(value: unknown, label: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim();
}

/** Seal one externally recorded purchase/delivery outcome for downstream reconciliation. */
export function sealHumanDeliveryEvidence(
  input: HumanDeliveryEvidenceInput,
): DeliveryEvidenceValidation {
  const basketId = required(input.basketId, "basketId");
  const orderReference = required(input.orderReference, "orderReference");
  const retailer = required(input.retailer, "retailer");
  const capturedAt = required(input.capturedAt, "capturedAt");
  const capturedBy = required(input.capturedBy, "capturedBy");

  if (!basketId || !orderReference || !retailer || !capturedAt || !capturedBy) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "basketId, orderReference, retailer, capturedAt and capturedBy are required." };
  }
  if (Number.isNaN(Date.parse(capturedAt))) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "capturedAt must be a parseable timestamp." };
  }
  if (!input.delivery || input.delivery.reconciliationStatus !== "RECONCILED") {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Only a RECONCILED delivery may be sealed as household evidence." };
  }

  const evidenceCore = {
    basketId,
    orderReference,
    retailer,
    capturedAt,
    capturedBy,
    delivery: input.delivery,
    evidenceNote: input.evidenceNote?.trim() || null,
  };
  const digest = hashOf(evidenceCore);
  const evidenceId = `DELIVERY-EVIDENCE:${digest}`;

  return {
    ok: true,
    evidence: {
      ...evidenceCore,
      evidenceId,
      provenance: "HUMAN_RECORDED_PURCHASE_DELIVERY",
      digest,
    },
  };
}

/** Verify that a previously sealed envelope has not been altered. */
export function verifyHumanDeliveryEvidence(evidence: HumanDeliveryEvidence): boolean {
  return (
    evidence.provenance === "HUMAN_RECORDED_PURCHASE_DELIVERY" &&
    evidence.digest ===
      hashOf({
        basketId: evidence.basketId,
        orderReference: evidence.orderReference,
        retailer: evidence.retailer,
        capturedAt: evidence.capturedAt,
        capturedBy: evidence.capturedBy,
        delivery: evidence.delivery,
        evidenceNote: evidence.evidenceNote,
      }) &&
    evidence.evidenceId === `DELIVERY-EVIDENCE:${evidence.digest}`
  );
}
