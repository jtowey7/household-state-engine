import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/production-baseline-once.yml";

const workflow = readFileSync(workflowPath, "utf8");

describe("production baseline workflow safety contract", () => {
  it("requires the protected production-baseline environment", () => {
    expect(workflow).toMatch(/jobs:\s+execute-production-baseline:\s+environment:\s+production-baseline/m);
  });

  it("keeps the one-shot confirmation gate before the production executor", () => {
    const confirmation = workflow.indexOf('test "$FOODOS_BASELINE_EXECUTE" = "CONFIRM_ONE_TIME_BASELINE"');
    const executor = workflow.indexOf("run: bun run baseline:production");

    expect(confirmation).toBeGreaterThan(-1);
    expect(executor).toBeGreaterThan(confirmation);
  });

  it("does not move production execution onto a pull-request workflow", () => {
    expect(workflow).toMatch(/on:\s+workflow_dispatch:/m);
    expect(workflow).not.toMatch(/on:\s+[\s\S]*pull_request:/m);
  });
});
