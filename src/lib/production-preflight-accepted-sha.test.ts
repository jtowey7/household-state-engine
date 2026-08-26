import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dispatcher = readFileSync(
  resolve(process.cwd(), ".github/workflows/runtime-acceptance-dispatcher.yml"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), ".github/workflows/production-read-preflight.yml"),
  "utf8",
);

describe("Production preflight accepted-SHA binding", () => {
  it("passes the Phase 7 accepted SHA as an explicit workflow input", () => {
    expect(dispatcher).toContain("-f accepted_sha=\"$ACCEPTED_SHA\"");
  });

  it("requires the accepted SHA input and checks it against current main", () => {
    expect(preflight).toContain("accepted_sha:");
    expect(preflight).toContain("EXPECTED_SHA: ${{ inputs.accepted_sha }}");
    expect(preflight).toContain("current_main_sha");
    expect(preflight).toContain('test \"$current_main_sha\" = \"$EXPECTED_SHA\"');
  });

  it("checks the deployed runtime against the immutable accepted SHA", () => {
    expect(preflight).toContain('response=\"$(curl');
    expect(preflight).toContain('expected=$EXPECTED_SHA');
    expect(preflight).toContain('if [ \"$response\" = \"$EXPECTED_SHA\" ]; then');
  });

  it("checks out the accepted SHA rather than a mutable main ref", () => {
    expect(preflight).toContain("ref: ${{ inputs.accepted_sha }}");
    expect(preflight).toContain('checked_out_sha=\"$(git rev-parse HEAD)\"');
    expect(preflight).toContain('test \"$checked_out_sha\" = \"$EXPECTED_SHA\"');
  });
});
