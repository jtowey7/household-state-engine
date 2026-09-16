import { describe, expect, it } from "vitest";
import {
  authorizeOperatorSession,
  createOperatorSession,
  describeAccessCodeMismatch,
  missingServerConfiguration,
  normaliseAccessCode,
} from "./operator-read-auth";

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
      "LOVABLE_API_KEY",
    ]);
    expect(body.error).toContain("not the problem");
  });

  it("reports only the bindings that are actually absent", () => {
    expect(
      missingServerConfiguration({ FOODOS_OPERATOR_READ_TOKEN: "t", AIRTABLE_API_KEY: "k", LOVABLE_API_KEY: "l" }),
    ).toEqual(["AIRTABLE_FOOD_OS_BASE_ID"]);
    expect(
      missingServerConfiguration({ FOODOS_OPERATOR_READ_TOKEN: "t", AIRTABLE_API_KEY: "k", AIRTABLE_FOOD_OS_BASE_ID: "b", LOVABLE_API_KEY: "l" }),
    ).toEqual([]);
  });

  it("still rejects a wrong access code when the deployment is configured", async () => {
    const response = await createOperatorSession("wrong", {
      FOODOS_OPERATOR_READ_TOKEN: "right",
      AIRTABLE_API_KEY: "k",
      AIRTABLE_FOOD_OS_BASE_ID: "b",
      LOVABLE_API_KEY: "l",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });
});

describe("access code normalisation across secret managers and keyboards", () => {
  const configured = {
    AIRTABLE_API_KEY: "k",
    AIRTABLE_FOOD_OS_BASE_ID: "b",
    LOVABLE_API_KEY: "l",
  };

  it("accepts the same code when the stored secret carries wrapping quotes or whitespace", async () => {
    const response = await createOperatorSession("household-code", {
      ...configured,
      FOODOS_OPERATOR_READ_TOKEN: '  "household-code"\n',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("accepts the same code when the typed value carries invisible copy/paste characters", async () => {
    const response = await createOperatorSession("\uFEFFhousehold-code\u200B", {
      ...configured,
      FOODOS_OPERATOR_READ_TOKEN: "household-code",
    });
    expect(response.status).toBe(200);
  });

  it("still refuses a genuinely different code and never echoes either value", async () => {
    const response = await createOperatorSession("other-code", {
      ...configured,
      FOODOS_OPERATOR_READ_TOKEN: "household-code",
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { detail: string; error: string };
    expect(body.detail).toBe("The code entered is different from the one saved for this deployment.");
    expect(`${body.detail} ${body.error}`).not.toContain("household-code");
  });

  it("names capitalisation as the difference without revealing the code", async () => {
    const response = await createOperatorSession("HOUSEHOLD-CODE", {
      ...configured,
      FOODOS_OPERATOR_READ_TOKEN: "household-code",
    });
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("capitalisation");
    expect(body.detail).not.toContain("household-code");
  });

  it("normalises visually identical Unicode forms", () => {
    expect(normaliseAccessCode("ﬁne-code")).toBe("fine-code");
  });
});

describe("mismatch description safety", () => {
  it("describes an empty entry, spacing and difference without exposing the secret", () => {
    expect(describeAccessCodeMismatch("", "secret-value")).toBe("No access code was entered.");
    expect(describeAccessCodeMismatch("secret value", "secretvalue")).toContain("spaces");
    expect(describeAccessCodeMismatch("nope", "secret-value")).not.toContain("secret-value");
  });
});
