import { describe, expect, it } from "vitest";
import { runContractConformance } from "./contract-conformance";

describe("event-contract conformance harness", () => {
  it("reports every contract clause as passing", () => {
    const report = runContractConformance();
    expect(report.checks.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    expect(report.checks.filter((c) => !c.passed).map((c) => c.clause)).toEqual([]);
    expect(report.allPassed).toBe(true);
    expect(report.failed).toBe(0);
  });

  it("is itself deterministic", () => {
    expect(runContractConformance()).toEqual(runContractConformance());
  });
});
