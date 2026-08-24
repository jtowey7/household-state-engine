import { describe, expect, it } from "vitest";

import { validateBasketIntegrity } from "./integrity";
import type { CandidateBasket } from "./types";

function basket(overrides: Partial<CandidateBasket> = {}): CandidateBasket {
  return {
    basketId: "BASKET-1",
    planId: "PLAN-1",
    snapshotId: "SNAP-1",
    replayId: "REPLAY-1",
    replayTimestamp: "2026-08-20T00:00:00.000Z",
    retailer: "Synthetic Tesco",
    lines: [
      {
        itemKey: "milk",
        sku: "MILK-1",
        productName: "Milk 2L",
        retailer: "Synthetic Tesco",
        requiredQuantity: 2,
        unit: "L",
        packSize: 2,
        packUnit: "L",
        packCount: 1,
        orderedQuantity: 2,
        lineCost: 1.8,
        sourceEventIds: ["E1"],
        requirementIds: ["R1"],
        requirementCount: 1,
      },
    ],
    exceptions: [],
    totalCost: 1.8,
    coverage: {
      demandItemKeys: ["milk"],
      sourcedItemKeys: ["milk"],
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
    ...overrides,
  };
}

describe("validateBasketIntegrity", () => {
  it("accepts a structurally coherent basket", () => {
    expect(validateBasketIntegrity(basket())).toEqual([]);
  });

  it("rejects an item marked both sourced and unsourced", () => {
    const findings = validateBasketIntegrity(
      basket({
        coverage: {
          demandItemKeys: ["milk"],
          sourcedItemKeys: ["milk"],
          unsourcedItemKeys: ["milk"],
          complete: true,
        },
      }),
    );

    expect(findings.map((finding) => finding.code)).toContain("COVERAGE_SOURCE_STATUS_CONFLICT");
  });

  it("allows incomplete coverage but rejects contradictory coverage state", () => {
    const findings = validateBasketIntegrity(
      basket({
        complete: false,
        readyForApproval: false,
        coverage: {
          demandItemKeys: ["milk", "eggs"],
          sourcedItemKeys: ["milk"],
          unsourcedItemKeys: ["eggs"],
          complete: true,
        },
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["COVERAGE_FLAG_MISMATCH"]);
  });

  it("rejects coverage items outside demand and lines absent from sourced coverage", () => {
    const findings = validateBasketIntegrity(
      basket({
        coverage: {
          demandItemKeys: ["milk"],
          sourcedItemKeys: ["milk", "eggs"],
          unsourcedItemKeys: ["bread"],
          complete: true,
        },
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      "COVERAGE_OUTSIDE_DEMAND",
      "COVERAGE_OUTSIDE_DEMAND",
      "SOURCED_COVERAGE_OUTSIDE_DEMAND",
      "UNSOURCED_COVERAGE_OUTSIDE_DEMAND",
      "COMPLETE_COVERAGE_COUNT_MISMATCH",
      "SOURCED_COVERAGE_WITHOUT_LINE",
    ]);
  });

  it("rejects sourced coverage that has no corresponding basket line even when counts reconcile", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [basket().lines[0]!],
        coverage: {
          demandItemKeys: ["milk", "eggs"],
          sourcedItemKeys: ["milk", "eggs"],
          unsourcedItemKeys: [],
          complete: true,
        },
        complete: true,
      }),
    );

    expect(findings.map((finding) => finding.code)).toContain("SOURCED_COVERAGE_WITHOUT_LINE");
  });

  it("rejects duplicate item lines and unreconciled total cost", () => {
    const line = basket().lines[0]!;
    const findings = validateBasketIntegrity(
      basket({
        lines: [line, { ...line, sku: "MILK-2", lineCost: 2.1 }],
        totalCost: 3.8,
      }),
    );

    expect(findings.map((finding) => finding.code)).toContain("DUPLICATE_ITEM_LINES");
    expect(findings.map((finding) => finding.code)).toContain("TOTAL_COST_MISMATCH");
  });

  it("rejects missing provenance and invalid line arithmetic", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [{ ...basket().lines[0]!, sourceEventIds: [], requiredQuantity: -1, packSize: 0 }],
        totalCost: 1.8,
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      "LINE_MISSING_PROVENANCE",
      "INVALID_LINE_ARITHMETIC",
    ]);
  });

  it("rejects blank source event provenance", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [{ ...basket().lines[0]!, sourceEventIds: ["  "] }],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["LINE_MISSING_PROVENANCE"]);
  });

  it("rejects duplicate source event provenance", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [{ ...basket().lines[0]!, sourceEventIds: ["E1", "E1"] }],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["DUPLICATE_SOURCE_EVENT_IDS"]);
  });

  it("rejects ordered quantity that cannot be produced by the declared pack count", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [{ ...basket().lines[0]!, packCount: 1, orderedQuantity: 4 }],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["INVALID_LINE_ARITHMETIC"]);
  });

  it("rejects non-integer pack counts", () => {
    const findings = validateBasketIntegrity(
      basket({
        lines: [{ ...basket().lines[0]!, packCount: 1.5, orderedQuantity: 3 }],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["INVALID_LINE_ARITHMETIC"]);
  });

  it("rejects non-finite and unreconciled totals", () => {
    expect(validateBasketIntegrity(basket({ totalCost: Number.NaN })).map((finding) => finding.code)).toEqual([
      "INVALID_TOTAL_COST",
    ]);
    expect(validateBasketIntegrity(basket({ totalCost: 9.99 })).map((finding) => finding.code)).toEqual([
      "TOTAL_COST_MISMATCH",
    ]);
  });

  it("is deterministic for identical input", () => {
    const a = validateBasketIntegrity(basket());
    const b = validateBasketIntegrity(basket());
    expect(b).toEqual(a);
  });
});
