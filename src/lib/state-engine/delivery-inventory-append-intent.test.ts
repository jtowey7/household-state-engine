import { describe, expect, it } from "vitest";
import { buildDeliveryAppendIntents } from "./delivery-inventory-append-intent";

describe("buildDeliveryAppendIntents", () => {
  const delivery = {
    deliveryId: "delivery-family-alpha-2026-08-30",
    deliveredAt: "2026-08-30T18:45:00Z",
    reconciliationStatus: "RECONCILED" as const,
    lines: [
      { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
      { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
      { lineId: "line-zero", itemKey: "Ignored", deliveredQuantity: 0, unit: "each" },
    ],
  };

  it("prepares only actually delivered positive quantities", () => {
    const intents = buildDeliveryAppendIntents(delivery);
    expect(intents).toHaveLength(2);
    expect(intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "Delivery", item: "Chicken breast", quantityDelta: 2 }),
        expect.objectContaining({ eventType: "Delivery", item: "Limes", quantityDelta: 1 }),
      ]),
    );
    expect(intents.some((intent) => intent.item === "Lemons")).toBe(false);
    expect(intents.some((intent) => intent.item === "Ignored")).toBe(false);
  });

  it("preserves substitution evidence without creating the ordered item", () => {
    const lime = buildDeliveryAppendIntents(delivery).find((intent) => intent.item === "Limes");
    expect(lime?.evidence).toContain("substituted=true");
    expect(lime?.entityReference).toBe("delivery-family-alpha-2026-08-30:line-lime");
  });

  it("fails closed when delivery is not reconciled", () => {
    expect(() =>
      buildDeliveryAppendIntents({ ...delivery, reconciliationStatus: "PENDING" as never }),
    ).toThrow("Only RECONCILED deliveries may produce append intents");
  });

  it("fails closed on non-finite quantities even when they are not positive", () => {
    expect(() =>
      buildDeliveryAppendIntents({
        ...delivery,
        lines: [{ lineId: "line-nan", itemKey: "Broken", deliveredQuantity: Number.NaN, unit: "each" }],
      }),
    ).toThrow("deliveredQuantity for line-nan must be finite and non-negative");
  });
});
