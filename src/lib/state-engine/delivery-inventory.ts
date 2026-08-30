import { hashOf } from "./hash";
import type { HouseholdEvent } from "./types";

export interface ReconciledDeliveryLine {
  /** Stable identifier for the delivered line from the persisted delivery evidence. */
  lineId: string;
  /** Canonical household item key to receive into stock. */
  itemKey: string;
  /** Quantity actually delivered, not the quantity ordered. */
  deliveredQuantity: number;
  /** Unit for the delivered quantity. */
  unit?: string | null;
  /** True when the delivered item differs from the originally ordered item. */
  substituted?: boolean;
}

export interface ReconciledDelivery {
  /** Stable identifier for the persisted delivery evidence. */
  deliveryId: string;
  /** Delivery occurrence timestamp. */
  deliveredAt: string;
  /** Only a completed, explicitly reconciled delivery may advance stock. */
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
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

/**
 * Converts an explicitly reconciled delivery into append-only inventory deltas.
 *
 * This is deliberately a pure development/state-engine seam: it creates no
 * Airtable writes and cannot touch Production state. A delivered quantity is
 * additive stock (ITEM_STOCK_DELTA), while substitutions simply credit the
 * actually delivered canonical item. Unresolved deliveries are rejected rather
 * than silently advancing inventory.
 */
export function buildDeliveryInventoryTransition(
  delivery: ReconciledDelivery,
): DeliveryInventoryTransition {
  const deliveryId = nonEmpty(delivery.deliveryId, "deliveryId");
  const deliveredAt = nonEmpty(delivery.deliveredAt, "deliveredAt");
  if (!Number.isFinite(Date.parse(deliveredAt))) {
    throw new Error(`deliveredAt must be a valid ISO timestamp: ${delivery.deliveredAt}`);
  }
  if (delivery.reconciliationStatus !== "RECONCILED") {
    throw new Error("Only RECONCILED deliveries may advance inventory");
  }
  if (delivery.lines.length === 0) throw new Error("A reconciled delivery must contain at least one line");

  const seenLineIds = new Set<string>();
  const events: HouseholdEvent[] = [];

  for (const line of delivery.lines) {
    const lineId = nonEmpty(line.lineId, "lineId");
    const itemKey = nonEmpty(line.itemKey, "itemKey");
    if (seenLineIds.has(lineId)) throw new Error(`Duplicate delivery lineId: ${lineId}`);
    seenLineIds.add(lineId);
    assertFiniteNonNegative(line.deliveredQuantity, `deliveredQuantity for ${lineId}`);
    if (line.deliveredQuantity === 0) continue;

    const unit = typeof line.unit === "string" ? line.unit.trim() : "";
    const identity = {
      deliveryId,
      lineId,
      itemKey,
      deliveredQuantity: line.deliveredQuantity,
      unit,
      substituted: line.substituted === true,
    };
    const eventId = `DELIVERY:${hashOf(identity)}`;

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
          `lineId=${lineId}`,
          `substituted=${line.substituted === true ? "true" : "false"}`,
        ].join(";"),
      },
    });
  }

  events.sort((a, b) => a.eventId.localeCompare(b.eventId));
  const transitionId = hashOf({
    deliveryId,
    deliveredAt,
    events: events.map((event) => ({
      eventId: event.eventId,
      itemKey: event.itemKey,
      quantity: event.payload.quantity,
      unit: event.payload.unit ?? "",
      note: event.payload.note ?? "",
    })),
  });

  return { deliveryId, events, transitionId };
}
