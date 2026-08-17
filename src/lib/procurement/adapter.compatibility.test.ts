import { describe, expect, it } from "vitest";
import { aggregateCandidateBasket } from "./adapter";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R-COMPAT",
  snapshotId: "S-COMPAT",
  replayTimestamp: "2026-08-17T00:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-COMPAT",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      itemKey: "milk-whole",
      requiredQuantity: 2,
      unit: "L",
      onHandQuantity: 0,
      targetQuantity: 2,
      sourceEventIds: ["OPEN-MILK"],
      packSize: 1,
      packCount: 2,
      packRoundedQuantity: 2,
    },
  ],
};

describe("procurement pack-unit compatibility", () => {
  it("chooses a compatible pack even when an incompatible pack is cheaper per unit", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [
        {
          itemKey: "milk-whole",
          sku: "SKU-CHEAP-INVALID",
          productName: "Milk measured in cartons",
          retailer: "synthetic-grocer",
          packSize: 1,
          packUnit: "carton",
          packPrice: 0.5,
        },
        {
          itemKey: "milk-whole",
          sku: "SKU-VALID-L",
          productName: "Whole Milk 1L",
          retailer: "synthetic-grocer",
          packSize: 1,
          packUnit: "L",
          packPrice: 1.2,
        },
      ],
    });

    expect(basket.complete).toBe(true);
    expect(basket.exceptions).toEqual([]);
    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0]).toMatchObject({
      sku: "SKU-VALID-L",
      packUnit: "L",
      packCount: 2,
      orderedQuantity: 2,
      lineCost: 2.4,
    });
  });
});
