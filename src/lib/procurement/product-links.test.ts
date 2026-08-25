import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import type { CatalogueEntry } from "./types";

const plan: QuantityRunPlan = {
  replayId: "REPLAY-LINKS",
  snapshotId: "SNAP-LINKS",
  replayTimestamp: "2026-08-25T08:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "PLAN-LINKS",
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
      sourceEventIds: ["EVENT-MILK"],
      packSize: 1,
      packCount: 2,
      packRoundedQuantity: 2,
    },
  ],
};

const catalogue: CatalogueEntry[] = [
  {
    itemKey: "milk-whole",
    sku: "MILK-1L",
    productName: "Whole Milk 1L",
    retailer: "synthetic-grocer",
    packSize: 1,
    packUnit: "L",
    packPrice: 1.2,
    productUrl: "https://shop.example.test/products/milk-1l",
  },
];

describe("Basket Phase 2 direct product-link provenance", () => {
  it("carries a verified HTTPS product URL into the basket line when links are required", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue,
      requireProductLinks: true,
      productUrlHostAllowlist: ["shop.example.test"],
      productUrlRetailerHosts: { "synthetic-grocer": ["shop.example.test"] },
    });

    expect(basket.exceptions).toEqual([]);
    expect(basket.readyForApproval).toBe(true);
    expect(basket.lines[0]?.productUrl).toBe("https://shop.example.test/products/milk-1l");
  });

  it("fails closed when the required retailer-host allowlist is absent", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue,
      requireProductLinks: true,
    });

    expect(basket.exceptions).toContainEqual({
      code: "UNVERIFIED_PRODUCT_URL",
      itemKey: "milk-whole",
      detail: 'Catalogue products for "milk-whole" do not have a direct HTTPS product URL on an allowed retailer host; line withheld for human sourcing.',
      fatal: false,
    });
    expect(basket.lines).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
  });

  it("rejects a product URL hosted outside the allowed retailer scope", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [{ ...catalogue[0]!, productUrl: "https://other-retailer.example/products/milk-1l" }],
      requireProductLinks: true,
      productUrlHostAllowlist: ["shop.example.test"],
      productUrlRetailerHosts: { "synthetic-grocer": ["shop.example.test"] },
    });

    expect(basket.exceptions).toContainEqual({
      code: "UNVERIFIED_PRODUCT_URL",
      itemKey: "milk-whole",
      detail: 'Catalogue products for "milk-whole" do not have a direct HTTPS product URL on an allowed retailer host; line withheld for human sourcing.',
      fatal: false,
    });
    expect(basket.readyForApproval).toBe(false);
  });

  it("rejects a URL whose allowed host belongs to a different retailer than the basket scope", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [{ ...catalogue[0]!, retailer: "tesco", productUrl: "https://groceries.asda.example/products/milk-1l" }],
      retailer: "tesco",
      requireProductLinks: true,
      productUrlHostAllowlist: ["groceries.asda.example"],
      productUrlRetailerHosts: { tesco: ["groceries.tesco.example"] },
    });

    expect(basket.exceptions).toContainEqual({
      code: "UNVERIFIED_PRODUCT_URL",
      itemKey: "milk-whole",
      detail: 'Catalogue products for "milk-whole" do not have a direct HTTPS product URL on an allowed retailer host; line withheld for human sourcing.',
      fatal: false,
    });
    expect(basket.lines).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
  });

  it("withholds a matched product when a required direct URL is missing", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [{ ...catalogue[0]!, productUrl: undefined }],
      requireProductLinks: true,
      productUrlHostAllowlist: ["shop.example.test"],
      productUrlRetailerHosts: { "synthetic-grocer": ["shop.example.test"] },
    });

    expect(basket.exceptions).toContainEqual({
      code: "MISSING_PRODUCT_URL",
      itemKey: "milk-whole",
      detail: 'Catalogue products for "milk-whole" do not include a verified direct HTTPS product URL; line withheld for human sourcing.',
      fatal: false,
    });
    expect(basket.lines).toEqual([]);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });

  it("rejects non-HTTPS links when direct links are required", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [{ ...catalogue[0]!, productUrl: "http://shop.example.test/products/milk-1l" }],
      requireProductLinks: true,
      productUrlHostAllowlist: ["shop.example.test"],
      productUrlRetailerHosts: { "synthetic-grocer": ["shop.example.test"] },
    });

    expect(basket.exceptions[0]?.code).toBe("UNVERIFIED_PRODUCT_URL");
    expect(basket.readyForApproval).toBe(false);
  });

  it("preserves legacy shadow behaviour when the link gate is not requested", () => {
    const basket = aggregateCandidateBasket(plan, {
      catalogue: [{ ...catalogue[0]!, productUrl: undefined }],
    });

    expect(basket.exceptions).toEqual([]);
    expect(basket.readyForApproval).toBe(true);
    expect(basket.lines[0]?.productUrl).toBeUndefined();
  });
});
