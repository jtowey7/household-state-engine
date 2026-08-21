import { describe, expect, it } from "vitest";

import { authorizeProductionRead } from "./production-read-auth";

const configuredEnv = { FOODOS_PRODUCTION_READ_TOKEN: "test-production-read-token" };

async function statusFor(request: Request, env: Record<string, unknown> | undefined) {
  const response = await authorizeProductionRead(request, env, undefined);
  return response?.status;
}

describe("production replay authentication boundary", () => {
  it("fails closed when the production read credential is not configured", async () => {
    expect(await statusFor(new Request("https://example.test/runtime/production/replay"), {})).toBe(503);
  });

  it("rejects an unauthenticated request", async () => {
    expect(await statusFor(new Request("https://example.test/runtime/production/replay"), configuredEnv)).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const request = new Request("https://example.test/runtime/production/replay", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(await statusFor(request, configuredEnv)).toBe(401);
  });

  it("accepts the configured bearer token", async () => {
    const request = new Request("https://example.test/runtime/production/replay", {
      headers: { authorization: "Bearer test-production-read-token" },
    });
    expect(await statusFor(request, configuredEnv)).toBeUndefined();
  });
});
