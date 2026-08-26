import { describe, expect, it } from "vitest";
import { BASKET_CANDIDATES_FIELDS, readCanonicalBasketForShop } from "./canonical-basket";
import type { FetchLike } from "../production-adapter/airtable-rest-source";

const env = {
  AIRTABLE_API_KEY: "test-airtable-key",
  AIRTABLE_FOOD_OS_BASE_ID: "appTEST000000000",
  AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "HOUSEHOLD EVENTS",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

describe("canonical Shop basket handoff", () => {
  it("fails closed when the canonical table has no reviewable basket", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      return jsonResponse({ records: [] });
    };

    const result = await readCanonicalBasketForShop(env, fetchImpl, "2026-08-26T09:00:00.000Z");
    expect(result).toMatchObject({
      status: "NOT_READY",
      source: "AIRTABLE_CANONICAL",
      reason: "NO_REVIEWABLE_BASKET",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.getAll("fields[]")).toEqual([...BASKET_CANDIDATES_FIELDS]);
    expect(params.get("filterByFormula")).toContain("Approval status");
  });

  it("refuses a pending row whose basket payload is missing or malformed", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        records: [
          {
            id: "recPENDING001",
            fields: {
              "Approval status": "PENDING",
              "Judge ID": "judge-1",
              "Judge verdict": "PASS",
              Retailer: "Tesco",
              "Estimated total": 20,
              "Basket payload": "not-json",
            },
          },
        ],
      });

    const result = await readCanonicalBasketForShop(env, fetchImpl, "2026-08-26T09:00:00.000Z");
    expect(result).toMatchObject({
      status: "NOT_READY",
      reason: "BASKET_PAYLOAD_INVALID",
    });
  });

  it("refuses an approved payload without complete approval provenance", async () => {
    const basket = {
      basketId: "basket-1",
      planId: "plan-1",
      snapshotId: "snapshot-1",
      replayId: "replay-1",
      replayTimestamp: "2026-08-26T08:00:00.000Z",
      retailer: "Tesco",
      lines: [{ itemKey: "milk", sku: "sku-1", productName: "Milk", retailer: "Tesco", requiredQuantity: 1, unit: "L", packSize: 1, packUnit: "L", packCount: 1, orderedQuantity: 1, lineCost: 2, sourceEventIds: [], requirementIds: ["req-1"], requirementCount: 1 }],
      exceptions: [],
      totalCost: 2,
      coverage: { demandItemKeys: ["milk"], sourcedItemKeys: ["milk"], unsourcedItemKeys: [], complete: true },
      complete: true,
      readyForReview: true,
      readyForApproval: true,
      dispatched: false,
      requiresHumanApproval: true,
    };

    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        records: [
          {
            id: "recAPPROVED002",
            fields: {
              "Approval status": "APPROVED",
              "Judge ID": "judge-1",
              "Judge verdict": "PASS",
              Retailer: "Tesco",
              "Estimated total": 2,
              "Basket payload": JSON.stringify(basket),
            },
          },
        ],
      });

    const result = await readCanonicalBasketForShop(env, fetchImpl, "2026-08-26T09:00:00.000Z");
    expect(result).toMatchObject({
      status: "NOT_READY",
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });
});
