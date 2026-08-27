import { describe, expect, it } from "vitest";
import { basketApprovalFingerprint } from "./approval";
import { persistCanonicalBasketCandidate } from "./canonical-basket-writer";
import type { CandidateBasket } from "./types";

function basket(): CandidateBasket {
  return {
    basketId: "basket-real-test-001",
    planId: "plan-real-test-001",
    snapshotId: "snapshot-real-test-001",
    replayId: "replay-real-test-001",
    replayTimestamp: "2026-08-26T09:00:00.000Z",
    retailer: "Tesco",
    lines: [
      {
        itemKey: "chicken-breast",
        sku: "TESCO-CHICKEN-1KG",
        productName: "Chicken Breast Fillets 1kg",
        retailer: "Tesco",
        requiredQuantity: 780,
        unit: "g",
        packSize: 1000,
        packUnit: "g",
        packCount: 1,
        orderedQuantity: 1000,
        lineCost: 6.69,
        productUrl: "https://www.tesco.com/groceries/en-GB/products/123456789",
        sourceEventIds: ["evt-production-001"],
        requirementIds: ["req-production-001"],
        requirementCount: 1,
      },
    ],
    exceptions: [],
    totalCost: 6.69,
    coverage: {
      demandItemKeys: ["chicken-breast"],
      sourcedItemKeys: ["chicken-breast"],
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

describe("persistCanonicalBasketCandidate", () => {
  it("writes only a PENDING, judge-PASS canonical basket", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      if (init?.method === "GET") return response({ records: [] });
      return response({ records: [{ id: "rec-canonical-001" }] });
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test-key", baseId: "app-test" },
      basket(),
      fetchImpl,
    );

    expect(result.status).toBe("PERSISTED");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("tblfnApCRftISnKJv");
    const body = JSON.parse(calls[1]!.body!);
    expect(body.records[0].fields["Approval status"]).toBe("PENDING");
    expect(body.records[0].fields["Judge verdict"]).toBe("PASS");
    expect(body.records[0].fields["Basket payload"]).toContain("basket-real-test-001");
    expect(body.records[0].fields["Approved at"]).toBeUndefined();
    expect(body.records[0].fields["Approved by"]).toBeUndefined();
    expect(body.performUpsert).toBeUndefined();
  });

  it("refuses incomplete baskets before any Airtable request", async () => {
    const incomplete = basket();
    incomplete.complete = false;
    incomplete.readyForApproval = false;
    incomplete.coverage.complete = false;
    incomplete.coverage.unsourcedItemKeys = ["chicken-breast"];
    incomplete.coverage.sourcedItemKeys = [];
    incomplete.lines = [];

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return response({ records: [] });
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test-key", baseId: "app-test" },
      incomplete,
      fetchImpl,
    );

    expect(result).toEqual({ status: "REFUSED", detail: "BASKET_NOT_APPROVAL_READY" });
    expect(calls).toBe(0);
  });

  it("deduplicates an existing Basket ID only when the stored fingerprint matches", async () => {
    const candidate = basket();
    const fingerprint = basketApprovalFingerprint(candidate);
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push(init?.method ?? "GET");
      return response({
        records: [{
          id: "rec-existing-001",
          fields: {
            Basket: candidate.basketId,
            "Basket fingerprint": fingerprint,
          },
        }],
      });
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test-key", baseId: "app-test" },
      candidate,
      fetchImpl,
    );

    expect(result).toEqual({
      status: "DEDUPLICATED",
      recordId: "rec-existing-001",
      basketId: "basket-real-test-001",
    });
    expect(calls).toEqual(["GET"]);
  });

  it("does not overwrite a different basket fingerprint if another writer wins between read and create", async () => {
    const candidate = basket();
    const calls: string[] = [];
    let getCount = 0;
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      if (method === "GET") {
        getCount += 1;
        if (getCount === 1) return response({ records: [] });
        return response({
          records: [{
            id: "rec-race-winner-001",
            fields: {
              Basket: candidate.basketId,
              "Basket fingerprint": "different-fingerprint-from-race-winner",
            },
          }],
        });
      }
      return response({ error: { type: "INVALID_REQUEST_ERROR", message: "duplicate/conflicting Basket" } }, false, 422);
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test-key", baseId: "app-test" },
      candidate,
      fetchImpl,
    );

    expect(result).toEqual({
      status: "REFUSED",
      detail: "BASKET_ID_FINGERPRINT_CONFLICT: Basket basket-real-test-001 already exists with a different or missing fingerprint; refusing silent overwrite.",
    });
    expect(calls).toEqual(["GET", "POST", "GET"]);
  });
});
