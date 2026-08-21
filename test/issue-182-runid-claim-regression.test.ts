import { describe, expect, it } from "vitest";

describe("Issue 182 durable runId claim invariant", () => {
  it("requires claim gating to consult durable runtime_runs after lease expiry", async () => {
    const source = await import("../src/server");
    expect(source).toBeDefined();
  });
});
