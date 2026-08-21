import { describe, expect, it } from "vitest";

import { validateRuntimeRunReplay } from "./runtime-run-idempotency";

describe("runtime run idempotency", () => {
  const existing = {
    taskId: "CLOUDFLARE-01-SYNTHETIC",
    agentId: "runtime-proof-A",
    outcome: "PASS",
    evidence: "evidence-v1",
  };

  it("accepts an exact duplicate as idempotent", () => {
    expect(validateRuntimeRunReplay(existing, { ...existing })).toEqual({ valid: true });
  });

  it("rejects the same run ID with different outcome or evidence", () => {
    expect(
      validateRuntimeRunReplay(existing, { ...existing, outcome: "FAIL" }),
    ).toEqual({ valid: false, reason: "Run payload conflict" });
    expect(
      validateRuntimeRunReplay(existing, { ...existing, evidence: "evidence-v2" }),
    ).toEqual({ valid: false, reason: "Run payload conflict" });
  });

  it("rejects the same run ID for a different task or agent", () => {
    expect(
      validateRuntimeRunReplay(existing, { ...existing, taskId: "OTHER" }),
    ).toEqual({ valid: false, reason: "Run identity conflict" });
    expect(
      validateRuntimeRunReplay(existing, { ...existing, agentId: "other-agent" }),
    ).toEqual({ valid: false, reason: "Run identity conflict" });
  });
});
