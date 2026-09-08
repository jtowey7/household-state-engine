import { describe, expect, it } from "vitest";
import { authorizeOperatorSession } from "./operator-read-auth";

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
