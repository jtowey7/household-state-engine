import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Production Read-Only Preflight contract", () => {
  it("fails closed when the baseline manifest is not reconciled-ready", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/production-read-preflight.yml"),
      "utf8",
    );

    expect(workflow).toContain("if (result.reconciledReady !== true)");
  });

  it("keeps the downstream replay handoff gate intact", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/production-read-preflight.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "if (result.quantityRequirementsHandoff?.readyForQuantityRun !== true)",
    );
    expect(workflow).toContain(
      "if ((result.quarantinedItemKeys ?? []).length !== 0)",
    );
  });
});
