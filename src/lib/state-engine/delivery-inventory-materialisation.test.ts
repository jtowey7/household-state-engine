import { describe, expect, it } from "vitest";
import { materialiseReconciledDelivery } from "./delivery-inventory-materialisation";

const delivery = {
  deliveryId: "delivery-family-alpha-2026-08-30",
  deliveredAt: "2026-08-30T18:45:00Z",
  reconciliationStatus: "RECONCILED" as const,
  lines: [
    { lineId: "line-chicken", itemKey: "Chicken breast", deliveredQuantity: 2, unit: "packs" },
    { lineId: "line-lime", itemKey: "Limes", deliveredQuantity: 1, unit: "each", substituted: true },
  ],
};

describe("materialiseReconciledDelivery", () => {
  it("feeds reconciled delivered quantities through the canonical replay path", () => {
    const result = materialiseReconciledDelivery(delivery, () => "2026-08-31T03:30:00Z");

    expect(result.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(result.snapshot.items).toEqual([
      expect.objectContaining({ itemKey: "Chicken breast", quantity: 2, unit: "packs", blocked: false }),
      expect.objectContaining({ itemKey: "Limes", quantity: 1, unit: "each", blocked: false }),
    ]);
    expect(result.snapshot.items.some((item) => item.itemKey === "Lemons")).toBe(false);
    expect(result.quantityHandoff.readyForQuantityRun).toBe(true);
    expect(result.quantityHandoff.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemKey: "Chicken breast", quantity: 2, unit: "packs" }),
        expect.objectContaining({ itemKey: "Limes", quantity: 1, unit: "each" }),
      ]),
    );
  });

  it("fails closed for unreconciled deliveries", () => {
    expect(() =>
      materialiseReconciledDelivery(
        { ...delivery, reconciliationStatus: "PENDING" as never },
        () => "2026-08-31T03:30:00Z",
      ),
    ).toThrow("Only RECONCILED deliveries may advance inventory");
  });

  it("remains deterministic for the same delivery and replay clock", () => {
    const a = materialiseReconciledDelivery(delivery, () => "2026-08-31T03:30:00Z");
    const b = materialiseReconciledDelivery(delivery, () => "2026-08-31T03:30:00Z");
    expect(b).toEqual(a);
  });
});
