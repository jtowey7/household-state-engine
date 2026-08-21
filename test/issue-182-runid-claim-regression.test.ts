import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue 182 durable runId claim invariant", () => {
  it("checks durable runtime_runs before accepting a runId after claim expiry", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server.ts"), "utf8");
    expect(source).toContain("AND NOT EXISTS (SELECT 1 FROM runtime_runs WHERE run_id = ?)");
    expect(source).toContain(".bind(crypto.randomUUID(), taskId, runId, agentId, now, expiresAt, taskId, taskId, runId, runId)");
  });
});
