import { describe, expect, it } from "vitest";
import { BASKET_CANDIDATES_FIELDS, readCanonicalApprovedBasket } from "./canonical-basket";
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
  it("fails closed when the canonical table has no approved basket", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      return jsonResponse({ records: [] });
    };

    const result = await readCanonicalApprovedBasket(env, fetchImpl, "2026-08-26T09:00:00.000Z");
    expect(result).toMatchObject({
      status: "NOT_READY",
      source: "AIRTABLE_CANONICAL",
      reason: "NO_APPROVED_BASKET",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.getAll("fields[]")).toEqual([...BASKET_CANDIDATES_FIELDS]);
    expect(params.get("filterByFormula")).toContain("Approval status");
  });

  it("refuses an approved row whose payload is missing or malformed", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        records: [
          {
            id: "recAPPROVED001",
            fields: {
              "Approval status": "APPROVED",
              "Approval ID": "approval-1",
              "Basket version": 1,
              "Basket fingerprint": "fingerprint-1",
              "Judge ID": "judge-1",
              "Approval policy identity": "submit-grocery-order:v1",
              "Approval policy version": 1,
              "Approved at": "2026-08-26T08:00:00.000Z",
              "Approved by": "James",
              Retailer: "Tesco",
              "Estimated total": 20,
              "Basket payload": "not-json",
            },
          },
        ],
      });

    const result = await readCanonicalApprovedBasket(env, fetchImpl, "2026-08-26T09:00:00.000Z");
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
      lines: [],
      exceptions: [],
      totalCost: 20,
      coverage: { demandItemKeys: [], sourcedItemKeys: [], unsourcedItemKeys: [], complete: true },
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
              Retailer: "Tesco",
              "Estimated total": 20,
              "Basket payload": JSON.stringify(basket),
            },
          },
        ],
      });

    const result = await readCanonicalApprovedBasket(env, fetchImpl, "2026-08-26T09:00:00.000Z");
    expect(result).toMatchObject({
      status: "NOT_READY",
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });
});
