import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from "./adapter";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R-TOTAL-COST",
  snapshotId: "S-TOTAL-COST",
  replayTimestamp: "2026-08-27T00:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-TOTAL-COST",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      itemKey: "rice-test",
      requiredQuantity: 300,
      unit: "g",
      onHandQuantity: 0,
      targetQuantity: 300,
      sourceEventIds: ["EVT-TOTAL-COST"],
      packSize: null,
      packCount: null,
      packRoundedQuantity: null,
    },
  ],
};

describe("catalogue selection by total purchase cost", () => {
  it("chooses the cheapest complete purchase, not merely the lowest unit price", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [
        {
          itemKey: "rice-test",
          sku: "SKU-RICE-1000",
          productName: "Rice 1kg",
          retailer: "synthetic-grocer",
          packSize: 1000,
          packUnit: "g",
          packPrice: 1.5,
        },
        {
          itemKey: "rice-test",
          sku: "SKU-RICE-250",
          productName: "Rice 250g",
          retailer: "synthetic-grocer",
          packSize: 250,
          packUnit: "g",
          packPrice: 0.5,
        },
      ],
      retailer: "synthetic-grocer",
    });

    const line = basket.lines[0]!;
    expect(line.sku).toBe("SKU-RICE-250");
    expect(line.packCount).toBe(2);
    expect(line.orderedQuantity).toBe(500);
    expect(line.lineCost).toBe(1);
    expect(basket.readyForApproval).toBe(true);
  });

  it("uses overage, then unit price, then SKU as deterministic tie-breakers", () => {
    const basket = aggregateCandidateBasket(
      {
        ...plan,
        requirements: [
          {
            ...plan.requirements[0]!,
            requiredQuantity: 500,
            targetQuantity: 500,
          },
        ],
      },
      {
        retailer: "synthetic-grocer",
        catalogue: [
          {
            itemKey: "rice-test",
            sku: "SKU-RICE-A",
            productName: "Rice A",
            retailer: "synthetic-grocer",
            packSize: 500,
            packUnit: "g",
            packPrice: 1,
          },
          {
            itemKey: "rice-test",
            sku: "SKU-RICE-B",
            productName: "Rice B",
            retailer: "synthetic-grocer",
            packSize: 250,
            packUnit: "g",
            packPrice: 0.5,
          },
        ],
      },
    );

    expect(basket.lines[0]?.sku).toBe("SKU-RICE-A");
    expect(basket.lines[0]?.packCount).toBe(1);
    expect(basket.lines[0]?.lineCost).toBe(1);
  });
});
