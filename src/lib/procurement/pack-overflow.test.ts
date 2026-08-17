import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from "./adapter";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const basePlan: QuantityRunPlan = {
  replayId: "R-OVERFLOW",
  snapshotId: "S-OVERFLOW",
  replayTimestamp: "2026-08-17T09:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-OVERFLOW",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      itemKey: "extreme-demand",
      requiredQuantity: Number.MAX_VALUE,
      unit: "g",
      onHandQuantity: 0,
      targetQuantity: Number.MAX_VALUE,
      sourceEventIds: ["EVT-OVERFLOW"],
      packSize: Number.MIN_VALUE,
      packCount: null,
      packRoundedQuantity: null,
    },
  ],
};

describe("procurement pack arithmetic safety", () => {
  it("withholds a line when pack-count arithmetic overflows", () => {
    const basket = aggregateCandidateBasket(basePlan, {
      catalogue: [
        {
          itemKey: "extreme-demand",
          sku: "SKU-TINY",
          productName: "Tiny pack",
          retailer: "synthetic-grocer",
          packSize: Number.MIN_VALUE,
          packUnit: "g",
          packPrice: 1,
        },
      ],
    });

    expect(basket.exceptions[0]?.code).toBe("PACK_CALCULATION_OVERFLOW");
    expect(basket.lines).toEqual([]);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });

  it("withholds a line when otherwise safe pack counts overflow line cost", () => {
    const basket = aggregateCandidateBasket(
      {
        ...basePlan,
        requirements: [{ ...basePlan.requirements[0]!, requiredQuantity: 2, targetQuantity: 2 }],
      },
      {
        catalogue: [
          {
            itemKey: "extreme-demand",
            sku: "SKU-HUGE-PRICE",
            productName: "Huge price pack",
            retailer: "synthetic-grocer",
            packSize: 1,
            packUnit: "g",
            packPrice: Number.MAX_VALUE,
          },
        ],
      },
    );

    expect(basket.exceptions[0]?.code).toBe("PACK_CALCULATION_OVERFLOW");
    expect(basket.lines).toEqual([]);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });
});
