import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Issue 182 durable runId claim invariant", () => {
  it("materialises the durable runId guard with matching D1 bind parameters", async () => {
    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

    expect(source).toContain("AND NOT EXISTS (SELECT 1 FROM runtime_claims WHERE run_id = ?)");
    expect(source).toContain("AND NOT EXISTS (SELECT 1 FROM runtime_runs WHERE run_id = ?)");
    expect(source).toContain("taskId, taskId, runId, runId),");
  });

  it("does not regress the active-claim duplicate-run guard", async () => {
    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(source).toContain("SELECT 1 FROM runtime_claims WHERE run_id = ?");
  });
});
