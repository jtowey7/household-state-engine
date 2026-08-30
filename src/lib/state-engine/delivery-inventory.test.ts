import { describe, expect, it } from "vitest";
import { buildDeliveryInventoryTransition } from "./delivery-inventory";

describe("buildDeliveryInventoryTransition", () => {
  const delivery = {
    deliveryId: "delivery-family-alpha-2026-08-30",
    deliveredAt: "2026-08-30T18:45:00Z",
    reconciliationStatus: "RECONCILED" as const,
    lines: [
      { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
      { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
    ],
  };

  it("creates additive exact stock events for actually delivered items", () => {
    const result = buildDeliveryInventoryTransition(delivery);
    expect(result.events).toHaveLength(2);
    expect(result.events.every((event) => event.eventType === "ITEM_STOCK_DELTA")).toBe(true);
    expect(result.events.every((event) => event.recordClass === "Production")).toBe(true);
    expect(result.events.map((event) => event.itemKey).sort()).toEqual(["Chicken breast", "Limes"]);
    expect(result.events.find((event) => event.itemKey === "Limes")?.payload.evidencePrecision).toBe("EXACT");
  });

  it("credits the substituted item and does not invent stock for the ordered item", () => {
    const result = buildDeliveryInventoryTransition(delivery);
    expect(result.events.some((event) => event.itemKey === "Limes")).toBe(true);
    expect(result.events.some((event) => event.itemKey === "Lemons")).toBe(false);
    expect(result.events.find((event) => event.itemKey === "Limes")?.payload.note).toContain("substituted=true");
  });

  it("is deterministic regardless of delivery-line order", () => {
    const reversed = { ...delivery, lines: [...delivery.lines].reverse() };
    const a = buildDeliveryInventoryTransition(delivery);
    const b = buildDeliveryInventoryTransition(reversed);
    expect(a).toEqual(b);
  });

  it("rejects an unreconciled delivery", () => {
    expect(() =>
      buildDeliveryInventoryTransition({
        ...delivery,
        reconciliationStatus: "PENDING" as never,
      }),
    ).toThrow("Only RECONCILED deliveries may advance inventory");
  });

  it("rejects duplicate line identities", () => {
    expect(() =>
      buildDeliveryInventoryTransition({
        ...delivery,
        lines: [delivery.lines[0], { ...delivery.lines[1], lineId: delivery.lines[0].lineId }],
      }),
    ).toThrow("Duplicate delivery lineId");
  });

  it("does not emit a zero-quantity stock event", () => {
    const result = buildDeliveryInventoryTransition({
      ...delivery,
      lines: [{ lineId: "zero", itemKey: "Tomatoes", deliveredQuantity: 0, unit: "each" }],
    });
    expect(result.events).toEqual([]);
  });
});
