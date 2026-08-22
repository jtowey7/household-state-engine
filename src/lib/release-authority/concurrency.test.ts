import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function workflowConcurrency(path: string) {
  const content = readFileSync(resolve(process.cwd(), path), "utf8");
  const group = content.match(/^\s{2}group:\s*(\S+)\s*$/m)?.[1];
  const cancelInProgress = content.match(/^\s{2}cancel-in-progress:\s*(\S+)\s*$/m)?.[1];
  return { group, cancelInProgress };
}

describe("release-authority workflow serialization", () => {
  it("shares the runtime deployment concurrency gate with the Family Alpha controlled write", () => {
    const runtime = workflowConcurrency(".github/workflows/cloudflare-runtime-test.yml");
    const controlledWrite = workflowConcurrency(".github/workflows/family-alpha-production-write.yml");

    expect(runtime.group).toBe("foodos-cloudflare-runtime-test");
    expect(controlledWrite.group).toBe(runtime.group);
    expect(runtime.cancelInProgress).toBe("false");
    expect(controlledWrite.cancelInProgress).toBe("false");
  });
});
