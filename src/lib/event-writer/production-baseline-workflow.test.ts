import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Production baseline workflow safety boundary", () => {
  it("refuses non-main dispatches and verifies the checked-out code is current main before transport", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/production-baseline-once.yml"),
      "utf8",
    );

    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("with:\n          ref: main");
    expect(workflow).toContain("current_main_sha=\"$(curl --fail-with-body --silent --show-error \\");
    expect(workflow).toContain("checked_out_sha=\"$(git rev-parse HEAD)\"");
    expect(workflow).toContain("test \"$GITHUB_REF\" = \"refs/heads/main\"");
    expect(workflow).toContain("test \"$checked_out_sha\" = \"$current_main_sha\"");
    expect(workflow).toContain("Require checkout to equal current main before any production transport");
  });
});
