import { describe, expect, it, vi } from "vitest";
import {
  canonicalBasketRuntimeResponse,
  resolveCanonicalBasketRuntimeConfig,
} from "./canonical-basket-runtime";

const fetchStub = vi.fn();

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
});
