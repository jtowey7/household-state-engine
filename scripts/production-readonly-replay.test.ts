import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production read-only replay wiring", () => {
  it("exposes the CLI used by the workflow and maps the declared inputs", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(
      ".github/workflows/production-readonly-replay.yml",
      "utf8",
    );

    expect(pkg.scripts?.["replay:production"]).toBe(
      "bun scripts/production-readonly-replay.ts",
    );
    expect(workflow).toContain(
      "bun run replay:production --as-of \"$FOODOS_REPLAY_AS_OF\" --base \"$AIRTABLE_BASE_ID\"",
    );
    expect(workflow).toContain(
      "AIRTABLE_FOOD_OS_BASE_ID: ${{ inputs.airtable_base_id }}",
    );
    expect(workflow).toContain(
      "AIRTABLE_HOUSEHOLD_EVENTS_TABLE: HOUSEHOLD EVENTS",
    );
  });
});
