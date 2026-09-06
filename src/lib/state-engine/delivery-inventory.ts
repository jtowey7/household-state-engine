import { hashOf } from "./hash";
import type { HouseholdEvent } from "./types";
import type { DispatchIntent } from "../procurement/dispatch";

export interface ReconciledDeliveryLine {
  lineId: string;
  itemKey: string;
  /** Originally expected canonical item; supplied by the exception-first UI for substitutions. */
  expectedItemKey?: string | null;
  deliveredQuantity: number;
  unit?: string | null;
  /** Reconciliation/UI classification only; never a distinct inventory event. */
  substituted?: boolean;
}

export interface ReconciledDelivery {
  deliveryId: string;
  dispatchId: string;
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  deliveredAt: string;
  reconciliationStatus: "RECONCILED";
  lines: readonly ReconciledDeliveryLine[];
}

export interface DeliveryInventoryTransition {
  deliveryId: string;
  events: HouseholdEvent[];
  transitionId: string;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
}

export function validateDeliveryDispatchProvenance(
  delivery: Pick<ReconciledDelivery, "dispatchId" | "basketId" | "basketVersion" | "basketFingerprint">,
  dispatch: Pick<DispatchIntent, "dispatchId" | "basketId" | "basketVersion" | "basketFingerprint">,
): void {
  if (delivery.dispatchId !== dispatch.dispatchId) throw new Error("Delivery provenance mismatch: DISPATCH_ID_MISMATCH");
  if (delivery.basketId !== dispatch.basketId) throw new Error("Delivery provenance mismatch: BASKET_ID_MISMATCH");
  if (delivery.basketVersion !== dispatch.basketVersion) throw new Error("Delivery provenance mismatch: BASKET_VERSION_MISMATCH");
  if (delivery.basketFingerprint !== dispatch.basketFingerprint) throw new Error("Delivery provenance mismatch: BASKET_FINGERPRINT_MISMATCH");
}

/**
 * Converts a reconciled delivery into additive inventory deltas only.
 * A substitution means the expected item was not received and the actual
 * replacement was received. The expected item therefore produces no stock
 * delta; expectedItemKey is retained only as reconciliation provenance.
 * Legacy callers may omit expectedItemKey until the UI migration is complete.
 */
export function buildDeliveryInventoryTransition(delivery: ReconciledDelivery): DeliveryInventoryTransition {
  const deliveryId = nonEmpty(delivery.deliveryId, "deliveryId");
  nonEmpty(delivery.dispatchId, "dispatchId");
  nonEmpty(delivery.basketId, "basketId");
  nonEmpty(delivery.basketFingerprint, "basketFingerprint");
  if (!Number.isInteger(delivery.basketVersion) || delivery.basketVersion < 1) throw new Error("basketVersion must be a positive integer");
  const deliveredAt = nonEmpty(delivery.deliveredAt, "deliveredAt");
  if (!Number.isFinite(Date.parse(deliveredAt))) throw new Error(`deliveredAt must be a valid ISO timestamp: ${delivery.deliveredAt}`);
  if (delivery.reconciliationStatus !== "RECONCILED") throw new Error("Only RECONCILED deliveries may advance inventory");
  if (delivery.lines.length === 0) throw new Error("A reconciled delivery must contain at least one line");

  const seenLineIds = new Set<string>();
  const events: HouseholdEvent[] = [];
  for (const line of delivery.lines) {
    const lineId = nonEmpty(line.lineId, "lineId");
    const itemKey = nonEmpty(line.itemKey, "itemKey");
    if (seenLineIds.has(lineId)) throw new Error(`Duplicate delivery lineId: ${lineId}`);
    seenLineIds.add(lineId);
    assertFiniteNonNegative(line.deliveredQuantity, `deliveredQuantity for ${lineId}`);
    if (line.substituted === true && line.expectedItemKey?.trim() && line.expectedItemKey.trim() === itemKey) {
      throw new Error(`Substitution for ${lineId} must identify a different expected item`);
    }
    if (line.deliveredQuantity === 0) continue;
    const eventId = `DELIVERY:${hashOf({ deliveryId, lineId })}`;
    const unit = typeof line.unit === "string" ? line.unit.trim() : "";
    events.push({
      eventId,
      recordClass: "Production",
      eventType: "ITEM_STOCK_DELTA",
      itemKey,
      occurredAt: deliveredAt,
      payload: {
        quantity: line.deliveredQuantity,
        ...(unit ? { unit } : {}),
        evidencePrecision: "EXACT",
        note: [
          "source=RECONCILED_DELIVERY",
          `deliveryId=${deliveryId}`,
          `dispatchId=${delivery.dispatchId}`,
          `lineId=${lineId}`,
          `substituted=${line.substituted === true ? "true" : "false"}`,
          ...(line.substituted === true && line.expectedItemKey?.trim() ? [`expectedItemKey=${line.expectedItemKey.trim()}`] : []),
        ].join(";"),
      },
    });
  }
  events.sort((a, b) => a.eventId.localeCompare(b.eventId));
  const transitionId = hashOf({
    deliveryId,
    dispatchId: delivery.dispatchId,
    basketId: delivery.basketId,
    basketVersion: delivery.basketVersion,
    basketFingerprint: delivery.basketFingerprint,
    deliveredAt,
    events: events.map((event) => ({ eventId: event.eventId, itemKey: event.itemKey, quantity: event.payload.quantity, unit: event.payload.unit ?? "", note: event.payload.note ?? "" })),
  });
  return { deliveryId, events, transitionId };
}