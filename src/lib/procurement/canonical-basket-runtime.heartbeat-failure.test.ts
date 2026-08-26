import { describe, expect, it, vi } from "vitest";
import { canonicalBasketRuntimeResponse } from "./canonical-basket-runtime";

function validBasket() {
  return {
    basketId: "basket-heartbeat-failure-001",
    planId: "plan-heartbeat-failure-001",
    snapshotId: "snapshot-heartbeat-failure-001",
    replayId: "replay-heartbeat-failure-001",
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
        sourceEventIds: ["evt-heartbeat-failure-001"],
        requirementIds: ["req-heartbeat-failure-001"],
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

function fakeFailingHeartbeatDatabase() {
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
      const releaseStatement = statements.find(
        (statement) => statement.sql.includes("SET status = 'READY'") && statement.sql.includes("claim_run_id = ?"),
      );

      if (releaseStatement) {
        locked = false;
        return statements.map(() => ({ meta: { changes: 1 } }));
      }
      if (heartbeatStatement) {
        return statements.map(() => ({ meta: { changes: 0 } }));
      }
      if (claimStatement) {
        if (locked) return statements.map(() => ({ meta: { changes: 0 } }));
        locked = true;
        return statements.map((statement) => ({
          meta: { changes: statement === claimStatement ? 1 : 0 },
        }));
      }
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  };
}

describe("canonical basket runtime heartbeat failure", () => {
  it("aborts the in-flight Airtable operation and fails closed when lease renewal fails", async () => {
    vi.useFakeTimers();
    try {
      const runtimeDatabase = fakeFailingHeartbeatDatabase();
      let sawAbortSignal = false;
      let fetchStarted = false;

      const fetchImpl = async (
        _url: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
          signal?: AbortSignal;
        },
      ) => {
        if (init?.method === "GET") {
          fetchStarted = true;
          sawAbortSignal = init.signal instanceof AbortSignal;
          await new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ records: [] }),
          json: async () => ({ records: [] }),
        };
      };

      const responsePromise = canonicalBasketRuntimeResponse(
        new Request("https://foodos.test/runtime/basket/candidate", {
          method: "POST",
          headers: { Authorization: "Bearer correct-token" },
          body: JSON.stringify({ basket: validBasket() }),
        }),
        {
          AIRTABLE_API_KEY: "key",
          AIRTABLE_FOOD_OS_BASE_ID: "appFoodOS",
          FOODOS_BASKET_WRITE_TOKEN: "correct-token",
          FOODOS_RUNTIME_TEST: runtimeDatabase,
        },
        fetchImpl,
      );

      while (!fetchStarted) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60 * 1000);

      const response = await responsePromise;
      expect(sawAbortSignal).toBe(true);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({
        ok: false,
        status: "REFUSED",
        detail: expect.stringContaining("BASKET_WRITE_LEASE_LOST"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
