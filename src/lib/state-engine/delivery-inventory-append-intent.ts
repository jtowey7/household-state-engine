import type { AppendIntent } from "../write-boundary/types";
import type { ReconciledDelivery } from "./delivery-inventory";

/**
 * Converts an already reconciled delivery into explicit append intents for the
 * existing HOUSEHOLD EVENTS write boundary. This is preparation only: it does
 * not canonicalise, authorise or write anything, and therefore cannot mutate
 * Production state.
 *
 * The intent deliberately uses the actual delivered item/quantity. A
 * substitution therefore credits the delivered canonical item and never
 * creates stock for the originally ordered item.
 */
export function buildDeliveryAppendIntents(
  delivery: ReconciledDelivery,
): AppendIntent[] {
  if (delivery.reconciliationStatus !== "RECONCILED") {
    throw new Error("Only RECONCILED deliveries may produce append intents");
  }

  const deliveryId = delivery.deliveryId.trim();
  if (!deliveryId) throw new Error("deliveryId is required");

  return delivery.lines
    .filter((line) => line.deliveredQuantity > 0)
    .map((line) => {
      const lineId = line.lineId.trim();
      const item = line.itemKey.trim();
      const unit = typeof line.unit === "string" ? line.unit.trim() : "";
      if (!lineId) throw new Error("lineId is required");
      if (!item) throw new Error("itemKey is required");
      if (!Number.isFinite(line.deliveredQuantity) || line.deliveredQuantity < 0) {
        throw new Error(`deliveredQuantity for ${lineId} must be finite and non-negative`);
      }
      if (!unit) throw new Error(`unit for ${lineId} is required before append preparation`);

      return {
        eventType: "Delivery",
        item,
        occurredAt: delivery.deliveredAt,
        quantityDelta: line.deliveredQuantity,
        unit,
        source: "Family Alpha reconciled delivery",
        actor: "FoodOS",
        entityType: "Delivery line",
        entityReference: `${deliveryId}:${lineId}`,
        evidence: `RECONCILED_DELIVERY;deliveryId=${deliveryId};lineId=${lineId};substituted=${line.substituted === true ? "true" : "false"}`,
        confidence: "High",
        recordClass: "Production",
      } satisfies AppendIntent;
    });
}
