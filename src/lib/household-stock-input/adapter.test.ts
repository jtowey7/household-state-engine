import { describe, expect, it } from "vitest";
import { proposeHouseholdStockInput, proposeHouseholdStockInputs } from "./adapter";

const options = {
  now: () => "2026-08-31T14:00:00.000Z",
};

describe("household stock input boundary", () => {
  it("turns an explicit stocktake into a TEST-only canonical correction proposal", () => {
    const result = proposeHouseholdStockInput(
      {
        inputId: "stocktake-001",
        itemKey: "Tesco Milk 2L",
        quantity: 1,
        unit: "unit",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      options,
    );

    expect(result.provenance).toBe("TEST");
    expect(result.productionMutation).toBe(false);
    expect(result.rejections).toHaveLength(0);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].recordClass).toBe("Test");
    expect(result.proposals[0].stateAfter).toBe(1);
    expect(result.proposals[0].preview.wouldWrite).toBe(false);
    expect(result.proposals[0].requiresHumanAuthorization).toBe(true);
  });

  it("refuses an ambiguous quantity instead of guessing", () => {
    const result = proposeHouseholdStockInput(
      {
        inputId: "stocktake-002",
        itemKey: "Tesco Rice 1Kg",
        quantity: "about half",
        unit: "pack",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      options,
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].code).toBe("AMBIGUOUS_QUANTITY");
    expect(result.productionMutation).toBe(false);
  });

  it("deduplicates an identical repeated stocktake", () => {
    const first = proposeHouseholdStockInput(
      {
        inputId: "stocktake-003",
        itemKey: "Tesco Eggs 12 Pack",
        quantity: 2,
        unit: "pack",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      options,
    );

    const second = proposeHouseholdStockInput(
      {
        inputId: "stocktake-003",
        itemKey: "Tesco Eggs 12 Pack",
        quantity: 2,
        unit: "pack",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      { ...options, knownProposals: first.fingerprints },
    );

    expect(second.proposals).toHaveLength(0);
    expect(second.deduped).toHaveLength(1);
    expect(second.productionMutation).toBe(false);
  });

  it("surfaces a conflicting reuse instead of overwriting the first stocktake", () => {
    const first = proposeHouseholdStockInput(
      {
        inputId: "stocktake-004",
        itemKey: "Tesco Bread",
        quantity: 1,
        unit: "unit",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      options,
    );

    const second = proposeHouseholdStockInput(
      {
        inputId: "stocktake-004",
        itemKey: "Tesco Bread",
        quantity: 0,
        unit: "unit",
        observedAt: "2026-08-31T13:55:00.000Z",
        reportedBy: "James",
        evidence: "Physical stocktake",
        reason: "Observed current on-hand stock",
      },
      { ...options, knownProposals: first.fingerprints },
    );

    expect(second.proposals).toHaveLength(0);
    expect(second.rejections).toHaveLength(1);
    expect(second.rejections[0].code).toBe("EXCEPTION_PAYLOAD_CONFLICT");
    expect(second.productionMutation).toBe(false);
  });

  it("keeps a batch of inputs independently traceable", () => {
    const result = proposeHouseholdStockInputs(
      [
        {
          inputId: "stocktake-005-a",
          itemKey: "Tesco Apples",
          quantity: 6,
          unit: "unit",
          observedAt: "2026-08-31T13:55:00.000Z",
          reportedBy: "James",
          evidence: "Physical stocktake",
          reason: "Observed current on-hand stock",
        },
        {
          inputId: "stocktake-005-b",
          itemKey: "Tesco Yogurt",
          quantity: 4,
          unit: "unit",
          observedAt: "2026-08-31T13:56:00.000Z",
          reportedBy: "James",
          evidence: "Physical stocktake",
          reason: "Observed current on-hand stock",
        },
      ],
      options,
    );

    expect(result.proposals).toHaveLength(2);
    expect(new Set(result.proposals.map((p) => p.exceptionId))).toEqual(
      new Set(["stocktake-005-a", "stocktake-005-b"]),
    );
    expect(result.proposals.every((p) => p.recordClass === "Test")).toBe(true);
    expect(result.productionMutation).toBe(false);
  });
});
