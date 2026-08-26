import { describe, expect, it, vi } from "vitest";
import {
  canonicalBasketRuntimeResponse,
  resolveCanonicalBasketRuntimeConfig,
} from "./canonical-basket-runtime";

const fetchStub = vi.fn();

function validBasket() {
  return {
    basketId: "basket-runtime-test-001",
    planId: "plan-runtime-test-001",
    snapshotId: "snapshot-runtime-test-001",
    replayId: "replay-runtime-test-001",
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
        sourceEventIds: ["evt-runtime-test-001"],
        requirementIds: ["req-runtime-test-001"],
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

function fakeRuntimeDatabase() {
  let locked = false;
  return {
    prepare(sql: string) {
      return {
        bind: (..._values: unknown[]) => ({ sql }),
      };
    },
    async batch(statements: { sql: string }[]) {
      const claimStatement = statements.find((statement) => statement.sql.includes("SET status = 'CLAIMED'"));
      const heartbeatStatement = statements.find(
        (statement) =>
          statement.sql.includes("SET lease_expires_at = ?") &&
          !statement.sql.includes("status = 'CLAIMED'"),
      );
      const releaseStatement = statements.find((statement) => statement.sql.includes("SET status = 'READY'") && statement.sql.includes("claim_run_id = ?"));
      if (releaseStatement) {
        locked = false;
        return statements.map(() => ({ meta: { changes: 1 } }));
      }
      if (heartbeatStatement) {
        return statements.map((statement) => ({
          meta: { changes: statement === heartbeatStatement ? (locked ? 1 : 0) : 1 },
        }));
      }
      if (claimStatement) {
        if (locked) return statements.map(() => ({ meta: { changes: 0 } }));
        locked = true;
        return statements.map((statement) => ({ meta: { changes: statement === claimStatement ? 1 : 0 } }));
      }
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  };
}

describe("canonical basket runtime write boundary", () => {
  it("fails closed when the dedicated write token is missing", async () => {
    expect(
      resolveCanonicalBasketRuntimeConfig({
        AIRTABLE_API_KEY: "key",
        AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
      }),
    ).toBeUndefined();

    const response = await canonicalBasketRuntimeResponse(
      new Request("https://foodos.test/runtime/basket/candidate", { method: "POST" }),
      { AIRTABLE_API_KEY: "key", AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS" },
      fetchStub,
    );

    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({
      ok: false,
      error: "Canonical basket writer not configured",
      missing: ["FOODOS_BASKET_WRITE_TOKEN"],
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token before reading the basket payload", async () => {
    const response = await canonicalBasketRuntimeResponse(
      new Request("https://foodos.test/runtime/basket/candidate", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
        body: JSON.stringify({ basket: {} }),
      }),
      {
        AIRTABLE_API_KEY: "key",
        AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
        FOODOS_BASKET_WRITE_TOKEN: "correct-token",
      },
      fetchStub,
    );

    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({
      ok: false,
      error: "Basket write authorization failed",
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses an incomplete basket without touching Airtable", async () => {
    const response = await canonicalBasketRuntimeResponse(
      new Request("https://foodos.test/runtime/basket/candidate", {
        method: "POST",
        headers: { Authorization: "Bearer correct-token" },
        body: JSON.stringify({
          basket: {
            basketId: "basket-test",
            planId: "plan-test",
            replayId: "replay-test",
            complete: false,
            readyForApproval: false,
          },
        }),
      }),
      {
        AIRTABLE_API_KEY: "key",
        AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
        FOODOS_BASKET_WRITE_TOKEN: "correct-token",
        FOODOS_RUNTIME_TEST: fakeRuntimeDatabase(),
      },
      fetchStub,
    );

    expect(response?.status).toBe(422);
    expect(await response?.json()).toMatchObject({
      ok: false,
      status: "REFUSED",
      detail: "BASKET_NOT_APPROVAL_READY",
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses a concurrent same-Basket write while the first request owns the runtime lock", async () => {
    const runtimeDatabase = fakeRuntimeDatabase();
    let firstFetchStarted = false;
    let releaseFirstFetch!: () => void;
    const firstFetchGate = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });

    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      if (init?.method === "GET" && !firstFetchStarted) {
        firstFetchStarted = true;
        await firstFetchGate;
        return response({ records: [] });
      }
      if (init?.method === "POST") return response({ records: [{ id: "rec-runtime-001" }] });
      return response({ records: [] });
    };

    const request = () =>
      new Request("https://foodos.test/runtime/basket/candidate", {
        method: "POST",
        headers: { Authorization: "Bearer correct-token" },
        body: JSON.stringify({ basket: validBasket() }),
      });
    const env = {
      AIRTABLE_API_KEY: "key",
      AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
      FOODOS_BASKET_WRITE_TOKEN: "correct-token",
      FOODOS_RUNTIME_TEST: runtimeDatabase,
    };

    const first = canonicalBasketRuntimeResponse(request(), env, fetchImpl);
    while (!firstFetchStarted) await Promise.resolve();

    const second = await canonicalBasketRuntimeResponse(request(), env, fetchImpl);
    expect(second?.status).toBe(409);
    expect(await second?.json()).toMatchObject({
      ok: false,
      status: "REFUSED",
      detail: expect.stringContaining("BASKET_WRITE_BUSY"),
    });

    releaseFirstFetch();
    const firstResponse = await first;
    expect(firstResponse?.status).toBe(201);
  });

  it("renews the lock so a long Airtable operation cannot expire it and admit a second writer", async () => {
    vi.useFakeTimers();
    try {
      const runtimeDatabase = fakeRuntimeDatabase();
      let firstFetchStarted = false;
      let releaseFirstFetch!: () => void;
      const firstFetchGate = new Promise<void>((resolve) => {
        releaseFirstFetch = resolve;
      });

      const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        if (init?.method === "GET" && !firstFetchStarted) {
          firstFetchStarted = true;
          await firstFetchGate;
          return response({ records: [] });
        }
        if (init?.method === "POST") return response({ records: [{ id: "rec-runtime-long-001" }] });
        return response({ records: [] });
      };

      const request = () =>
        new Request("https://foodos.test/runtime/basket/candidate", {
          method: "POST",
          headers: { Authorization: "Bearer correct-token" },
          body: JSON.stringify({ basket: validBasket() }),
        });
      const env = {
        AIRTABLE_API_KEY: "key",
        AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
        FOODOS_BASKET_WRITE_TOKEN: "correct-token",
        FOODOS_RUNTIME_TEST: runtimeDatabase,
      };

      const first = canonicalBasketRuntimeResponse(request(), env, fetchImpl);
      while (!firstFetchStarted) await Promise.resolve();

      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

      const second = await canonicalBasketRuntimeResponse(request(), env, fetchImpl);
      expect(second?.status).toBe(409);
      expect(await second?.json()).toMatchObject({
        ok: false,
        status: "REFUSED",
        detail: expect.stringContaining("BASKET_WRITE_BUSY"),
      });

      releaseFirstFetch();
      const firstResponse = await first;
      expect(firstResponse?.status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });
});
