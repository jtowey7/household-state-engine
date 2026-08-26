import { describe, expect, it } from "vitest";
import { persistCanonicalBasketCandidate } from "./canonical-basket-writer";
import type { CandidateBasket } from "./types";

function basket(): CandidateBasket {
  return {
    basketId: "basket-upsert-test-001",
    planId: "plan-upsert-test-001",
    snapshotId: "snapshot-upsert-test-001",
    replayId: "replay-upsert-test-001",
    replayTimestamp: "2026-08-26T09:30:00.000Z",
    retailer: "Tesco",
    lines: [
      {
        itemKey: "rice-basmati",
        sku: "TESCO-RICE-1KG",
        productName: "Basmati Rice 1kg",
        retailer: "Tesco",
        requiredQuantity: 1000,
        unit: "g",
        packSize: 1000,
        packUnit: "g",
        packCount: 1,
        orderedQuantity: 1000,
        lineCost: 2.5,
        productUrl: "https://www.tesco.com/groceries/en-GB/products/test-rice",
        sourceEventIds: ["evt-upsert-001"],
        requirementIds: ["req-upsert-001"],
        requirementCount: 1,
      },
    ],
    exceptions: [],
    totalCost: 2.5,
    coverage: {
      demandItemKeys: ["rice-basmati"],
      sourcedItemKeys: ["rice-basmati"],
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
  };
}

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

describe("canonical basket writer concurrency guard", () => {
  it("uses Airtable performUpsert on Basket ID so concurrent writers cannot create duplicate rows", async () => {
    const requests: { method: string; body?: string }[] = [];
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      requests.push({ method: init?.method ?? "GET", body: init?.body });
      if (init?.method === "GET") return response({ records: [] });
      return response({ records: [{ id: "rec-upsert-001", fields: { Basket: "basket-upsert-test-001" } }] });
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test-key", baseId: "app-test" },
      basket(),
      fetchImpl,
    );

    expect(result.status).toBe("PERSISTED");
    const write = requests.find((request) => request.method === "POST");
    expect(write).toBeDefined();
    const body = JSON.parse(write!.body!);
    expect(body.performUpsert).toEqual({ fieldsToMergeOn: ["Basket"] });
  });
});
