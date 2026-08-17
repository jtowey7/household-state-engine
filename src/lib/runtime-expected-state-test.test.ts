import { describe, expect, it } from "vitest";

import { runExpectedConsumptionRuntimeProof } from "./runtime-expected-state-test";

describe("runExpectedConsumptionRuntimeProof", () => {
  it("proves due consumption, future non-burn, explicit exceptions and confirmed handoff", () => {
    const proof = runExpectedConsumptionRuntimeProof();

    expect(proof.ok).toBe(true);
    expect(proof.assertions.pastExpectationBurned).toBe(true);
    expect(proof.assertions.pastConfirmationBurned).toBe(true);
    expect(proof.assertions.futureExpectationNotBurned).toBe(true);
    expect(proof.assertions.futureConfirmationNotBurned).toBe(true);
    expect(proof.assertions.missingProvenanceExpectationIgnored).toBe(true);
    expect(proof.assertions.unplannedConfirmedConsumptionIsExplicit).toBe(true);
    expect(proof.assertions.quantityHandoffUsesConfirmedState).toBe(true);
    expect(proof.assertions.runtimeIsNonMutating).toBe(true);
    expect(proof.assertions.deterministicReplay).toBe(true);
  });
});
