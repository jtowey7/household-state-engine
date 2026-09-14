import { describe, expect, it } from "vitest";
import { authorizeOperatorSession, createOperatorSession, missingServerConfiguration } from "./operator-read-auth";

describe("authorizeOperatorSession response shape", () => {
  it("returns the delivery read shape as well as the generic auth error", async () => {
    const response = await authorizeOperatorSession(
      new Request("https://foodos.local/runtime/procurement/delivery-basket"),
      { FOODOS_OPERATOR_READ_TOKEN: "test-token" },
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      error: "Operator session required",
      detail: "Operator session required",
      status: "NOT_READY",
    });
  });
});

describe("missing server configuration reporting", () => {
  it("names the missing bindings instead of blaming the access code", async () => {
    const response = await createOperatorSession("anything-the-user-typed", {});

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; missingConfiguration: string[]; error: string };
    expect(body.code).toBe("SERVER_NOT_CONFIGURED");
    expect(body.missingConfiguration).toEqual([
      "FOODOS_OPERATOR_READ_TOKEN",
      "AIRTABLE_API_KEY",
      "AIRTABLE_FOOD_OS_BASE_ID",
    ]);
    expect(body.error).toContain("not the problem");
  });

  it("reports only the bindings that are actually absent", () => {
    expect(
      missingServerConfiguration({ FOODOS_OPERATOR_READ_TOKEN: "t", AIRTABLE_API_KEY: "k" }),
    ).toEqual(["AIRTABLE_FOOD_OS_BASE_ID"]);
    expect(
      missingServerConfiguration({ FOODOS_OPERATOR_READ_TOKEN: "t", AIRTABLE_API_KEY: "k", AIRTABLE_FOOD_OS_BASE_ID: "b" }),
    ).toEqual([]);
  });

  it("still rejects a wrong access code when the deployment is configured", async () => {
    const response = await createOperatorSession("wrong", {
      FOODOS_OPERATOR_READ_TOKEN: "right",
      AIRTABLE_API_KEY: "k",
      AIRTABLE_FOOD_OS_BASE_ID: "b",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });
});
