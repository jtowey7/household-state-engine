import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
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
      itemKey: "oats-rolled",
      requiredQuantity: 1200,
      unit: "g",
      onHandQuantity: 800,
      targetQuantity: 2000,
      sourceEventIds: ["OPEN-A", "EVT-1"],
      packSize: 500,
      packCount: 3,
      packRoundedQuantity: 1500,
    },
    {
      itemKey: "milk-whole",
      requiredQuantity: 2,
      unit: "L",
      onHandQuantity: 4,
      targetQuantity: 6,
      sourceEventIds: ["OPEN-B"],
      packSize: 1,
      packCount: 2,
      packRoundedQuantity: 2,
    },
  ],
};

describe("aggregated procurement → candidate basket (shadow only)", () => {
  it("builds a deterministic basket from an eligible plan", () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue });
    expect(basket.lines.map((l) => l.itemKey)).toEqual(["milk-whole", "oats-rolled"]);
    expect(basket.readyForReview).toBe(true);
    expect(aggregateCandidateBasket(plan, { catalogue: shadowCatalogue }).basketId).toBe(basket.basketId);
  });

  it("never dispatches and always requires human approval", () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue });
    expect(basket.dispatched).toBe(false);
    expect(basket.requiresHumanApproval).toBe(true);
    expect("submit" in basket).toBe(false);
  });

  it("preserves provenance and replay identity end to end", () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue });
    expect(basket.snapshotId).toBe("S1");
    expect(basket.replayId).toBe("R1");
    expect(basket.lines.find((l) => l.itemKey === "oats-rolled")!.sourceEventIds).toEqual([
      "OPEN-A",
      "EVT-1",
    ]);
  });

  it("rounds up to whole packs and prices the line", () => {
    const line = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue }).lines.find(
      (l) => l.itemKey === "oats-rolled",
    )!;
    // Cheapest per gram is the 1kg pack (0.002/g vs 0.0024/g).
    expect(line.sku).toBe("SKU-OAT-1000");
    expect(line.packCount).toBe(2);
    expect(line.orderedQuantity).toBe(2000);
    expect(line.lineCost).toBe(4);
  });

  it("refuses to build a basket from an ineligible plan", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, executed: false, eligibleForProcurement: false, reconciliationStatus: "BLOCKED" },
      { catalogue: shadowCatalogue },
    );
    expect(basket.lines).toEqual([]);
    expect(basket.readyForReview).toBe(false);
    expect(basket.exceptions[0]?.code).toBe("PLAN_NOT_ELIGIBLE");
  });

  it("refuses when no plan is supplied instead of inventing demand", () => {
    const basket = aggregateCandidateBasket(null, { catalogue: shadowCatalogue });
    expect(basket.exceptions[0]?.code).toBe("PLAN_NOT_ELIGIBLE");
    expect(basket.totalCost).toBe(0);
  });

  it("withholds an unsourceable item without dropping the rest of the basket", () => {
    const basket = aggregateCandidateBasket(
      {
        ...plan,
        requirements: [
          ...plan.requirements,
          {
            itemKey: "saffron-threads",
            requiredQuantity: 5,
            unit: "g",
            onHandQuantity: 0,
            targetQuantity: 5,
            sourceEventIds: ["OPEN-Z"],
            packSize: null,
            packCount: null,
            packRoundedQuantity: null,
          },
        ],
      },
      { catalogue: shadowCatalogue },
    );
    expect(basket.exceptions.map((e) => e.code)).toEqual(["NO_CATALOGUE_MATCH"]);
    expect(basket.lines).toHaveLength(2);
    expect(basket.readyForReview).toBe(true);
  });

  it("refuses a pack measured in an incomparable unit", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, requirements: [plan.requirements[0]!] },
      {
        catalogue: [
          { itemKey: "oats-rolled", sku: "SKU-BAD", productName: "Oats (kg pack)", retailer: "synthetic-grocer", packSize: 1, packUnit: "kg", packPrice: 2 },
        ],
      },
    );
    expect(basket.exceptions[0]?.code).toBe("PACK_UNIT_MISMATCH");
    expect(basket.lines).toEqual([]);
  });

  it("ignores an invalid cheaper pack when a valid compatible pack exists", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, requirements: [plan.requirements[1]!] },
      {
        catalogue: [
          { itemKey: "milk-whole", sku: "SKU-ZERO", productName: "Invalid zero-size milk", retailer: "synthetic-grocer", packSize: 0, packUnit: "L", packPrice: 0.1 },
          { itemKey: "milk-whole", sku: "SKU-VALID", productName: "Whole Milk 1L", retailer: "synthetic-grocer", packSize: 1, packUnit: "L", packPrice: 1.2 },
        ],
      },
    );
    expect(basket.exceptions).toEqual([]);
    expect(basket.lines[0]).toMatchObject({ sku: "SKU-VALID", packCount: 2, lineCost: 2.4 });
    expect(basket.readyForApproval).toBe(true);
  });

  it("withholds an item when every catalogue pack has invalid economics", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, requirements: [plan.requirements[1]!] },
      {
        catalogue: [
          { itemKey: "milk-whole", sku: "SKU-NAN", productName: "Invalid NaN milk", retailer: "synthetic-grocer", packSize: Number.NaN, packUnit: "L", packPrice: 1.2 },
          { itemKey: "milk-whole", sku: "SKU-NEG", productName: "Invalid negative milk", retailer: "synthetic-grocer", packSize: 1, packUnit: "L", packPrice: -1 },
        ],
      },
    );
    expect(basket.exceptions[0]?.code).toBe("INVALID_CATALOGUE_ENTRY");
    expect(basket.lines).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.coverage.complete).toBe(false);
  });

  it("withholds non-finite requirement quantities instead of producing an invalid basket", () => {
    const basket = aggregateCandidateBasket(
      {
        ...plan,
        requirements: [{ ...plan.requirements[1]!, requiredQuantity: Number.POSITIVE_INFINITY }],
      },
      { catalogue: shadowCatalogue },
    );
    expect(basket.exceptions[0]?.code).toBe("NON_POSITIVE_REQUIREMENT");
    expect(basket.lines).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.coverage.complete).toBe(false);
  });

  it("withholds negative requirement quantities instead of netting them against valid demand", () => {
    const basket = aggregateCandidateBasket(
      {
        ...plan,
        requirements: [
          { ...plan.requirements[1]!, requiredQuantity: 3, requirementId: "REQ-POSITIVE" },
          { ...plan.requirements[1]!, requiredQuantity: -1, requirementId: "REQ-NEGATIVE" },
        ],
      },
      { catalogue: shadowCatalogue },
    );
    expect(basket.exceptions[0]?.code).toBe("NON_POSITIVE_REQUIREMENT");
    expect(basket.lines).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
  });

  it("scopes the basket to a single retailer when asked", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [
        ...shadowCatalogue,
        { itemKey: "milk-whole", sku: "SKU-ALT-MILK", productName: "Whole Milk 1L (alt)", retailer: "other-grocer", packSize: 1, packUnit: "L", packPrice: 0.5 },
      ],
      retailer: "synthetic-grocer",
    });
    expect(basket.retailer).toBe("synthetic-grocer");
    expect(basket.lines.every((l) => l.retailer === "synthetic-grocer")).toBe(true);
  });

  it("totals the basket cost deterministically", () => {
    const basket = aggregateCandidateBasket(plan, { catalogue: shadowCatalogue });
    expect(basket.totalCost).toBe(
      Math.round(basket.lines.reduce((s, l) => s + l.lineCost, 0) * 100) / 100,
    );
  });
});
