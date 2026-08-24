import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const plan: QuantityRunPlan = {
  replayId: "R1",
  snapshotId: "S1",
  replayTimestamp: "2026-08-03T20:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P1",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      itemKey: "   ",
      requiredQuantity: 1,
      unit: "L",
      onHandQuantity: 0,
      targetQuantity: 1,
      sourceEventIds: ["EVT-1"],
      packSize: 1,
      packCount: 1,
      packRoundedQuantity: 1,
    },
  ],
};

describe("catalogue boundary demand identity", () => {
  it("withholds a demand line whose itemKey is blank", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [
        {
          itemKey: "   ",
          sku: "SKU-BLANK-DEMAND",
          productName: "Whole Milk 1L",
          retailer: "synthetic-grocer",
          packSize: 1,
          packUnit: "L",
          packPrice: 1.2,
        },
      ],
    });

    expect(basket.exceptions[0]?.code).toBe("INVALID_DEMAND_ITEM_KEY");
    expect(basket.lines).toEqual([]);
    expect(basket.coverage.demandItemKeys).toEqual(["   "]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["   "]);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });
});
