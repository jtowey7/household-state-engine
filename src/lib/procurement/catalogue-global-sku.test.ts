import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R-GLOBAL",
  snapshotId: "S-GLOBAL",
  replayTimestamp: "2026-08-03T20:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-GLOBAL",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    { itemKey: "milk-whole", requiredQuantity: 2, unit: "L", onHandQuantity: 0, targetQuantity: 2, sourceEventIds: ["EVT-MILK"], packSize: 1, packCount: 2, packRoundedQuantity: 2 },
    { itemKey: "juice-orange", requiredQuantity: 2, unit: "L", onHandQuantity: 0, targetQuantity: 2, sourceEventIds: ["EVT-JUICE"], packSize: 1, packCount: 2, packRoundedQuantity: 2 },
  ],
};

describe("global retailer SKU identity", () => {
  it("withholds every affected item when one retailer SKU maps to conflicting products", () => {
    const basket = aggregateCandidateBasket(plan, {
      retailer: "synthetic-grocer",
      catalogue: [
        { itemKey: "milk-whole", sku: "SKU-REUSED", productName: "Whole Milk 1L", retailer: "synthetic-grocer", packSize: 1, packUnit: "L", packPrice: 1.2 },
        { itemKey: "juice-orange", sku: "SKU-REUSED", productName: "Orange Juice 2L", retailer: "synthetic-grocer", packSize: 2, packUnit: "L", packPrice: 2.1 },
      ],
    });

    expect(basket.lines).toEqual([]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["juice-orange", "milk-whole"]);
    expect(basket.exceptions).toHaveLength(2);
    expect(basket.exceptions.every((exception) => exception.code === "CATALOGUE_SKU_CONFLICT")).toBe(true);
    expect(basket.readyForApproval).toBe(false);
  });

  it("does not conflict when the same SKU is used independently by different retailers", () => {
    const basket = aggregateCandidateBasket(plan, {
      retailer: "retailer-a",
      catalogue: [
        { itemKey: "milk-whole", sku: "SKU-SHARED", productName: "Whole Milk 1L", retailer: "retailer-a", packSize: 1, packUnit: "L", packPrice: 1.2 },
        { itemKey: "milk-whole", sku: "SKU-SHARED", productName: "Whole Milk 2L", retailer: "retailer-b", packSize: 2, packUnit: "L", packPrice: 2.1 },
        { itemKey: "juice-orange", sku: "SKU-JUICE", productName: "Orange Juice 1L", retailer: "retailer-a", packSize: 1, packUnit: "L", packPrice: 1.4 },
      ],
    });

    expect(basket.exceptions).toEqual([]);
    expect(basket.lines).toHaveLength(2);
  });
});
