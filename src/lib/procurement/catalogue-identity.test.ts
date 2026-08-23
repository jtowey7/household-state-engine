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
      itemKey: "milk-whole",
      requiredQuantity: 2,
      unit: "L",
      onHandQuantity: 0,
      targetQuantity: 2,
      sourceEventIds: ["EVT-1"],
      packSize: 1,
      packCount: 2,
      packRoundedQuantity: 2,
    },
  ],
};

describe("catalogue SKU identity", () => {
  it("withholds a line when the same SKU has conflicting catalogue payloads", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [
        {
          itemKey: "milk-whole",
          sku: "SKU-MILK",
          productName: "Whole Milk 1L",
          retailer: "synthetic-grocer",
          packSize: 1,
          packUnit: "L",
          packPrice: 1.20,
        },
        {
          itemKey: "milk-whole",
          sku: "SKU-MILK",
          productName: "Whole Milk 2L",
          retailer: "synthetic-grocer",
          packSize: 2,
          packUnit: "L",
          packPrice: 2.10,
        },
      ],
    });

    expect(basket.lines).toEqual([]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["milk-whole"]);
    expect(basket.exceptions).toEqual([
      expect.objectContaining({
        code: "CATALOGUE_SKU_CONFLICT",
        itemKey: "milk-whole",
        fatal: false,
      }),
    ]);
    expect(basket.readyForApproval).toBe(false);
  });

  it("accepts identical duplicate catalogue rows for the same SKU", () => {
    const entry = {
      itemKey: "milk-whole",
      sku: "SKU-MILK",
      productName: "Whole Milk 1L",
      retailer: "synthetic-grocer",
      packSize: 1,
      packUnit: "L",
      packPrice: 1.20,
    };
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [entry, { ...entry }],
    });

    expect(basket.exceptions).toEqual([]);
    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0]).toMatchObject({ sku: "SKU-MILK", packCount: 2, lineCost: 2.4 });
  });

  it("accepts the same retailer SKU reused across demand aliases when its product payload is identical", () => {
    const aliasPlan = {
      ...plan,
      requirements: [
        ...plan.requirements,
        {
          ...plan.requirements[0],
          itemKey: "whole-milk-alias",
          sourceEventIds: ["EVT-2"],
        },
      ],
    };
    const entry = {
      itemKey: "milk-whole",
      sku: "SKU-MILK",
      productName: "Whole Milk 1L",
      retailer: "synthetic-grocer",
      packSize: 1,
      packUnit: "L",
      packPrice: 1.20,
    };
    const aliasEntry = { ...entry, itemKey: "whole-milk-alias" };

    const basket = aggregateCandidateBasket(aliasPlan, {
      catalogue: [entry, aliasEntry],
    });

    expect(basket.exceptions).toEqual([]);
    expect(basket.lines).toHaveLength(2);
    expect(basket.lines.map((line) => line.sku)).toEqual(["SKU-MILK", "SKU-MILK"]);
  });
});
