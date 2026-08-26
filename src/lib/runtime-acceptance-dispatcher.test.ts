import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/runtime-acceptance-dispatcher.yml"),
  "utf8",
);

describe("Production preflight dispatcher safety contract", () => {
  it("fails closed when the accepted SHA is no longer current main", () => {
    expect(workflow).toContain('test "$ACCEPTED_SHA" = "$current_main_sha"');
  });

  it("checks for an existing preflight run for the accepted SHA before dispatch", () => {
    expect(workflow).toContain(
      'gh run list --repo "$REPOSITORY" --workflow production-read-preflight.yml --branch main',
    );
    expect(workflow).toContain('select(.headSha == \\"$ACCEPTED_SHA\\")');
    expect(workflow).toContain('test "$existing" = "0"');
  });

  it("serializes dispatcher events without cancelling an earlier dispatcher", () => {
    expect(workflow).toContain("group: foodos-runtime-acceptance-dispatcher");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("dispatches only the read-only Production preflight after successful Phase 7 acceptance", () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("gh workflow run production-read-preflight.yml --repo \\\"$REPOSITORY\\\" --ref main");
  });
});
