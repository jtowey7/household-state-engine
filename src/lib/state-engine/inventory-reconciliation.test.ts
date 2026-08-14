import { describe, expect, it } from "vitest";
import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
} from "./inventory-reconciliation";

const BASELINE = "2026-08-14T20:00:00.000Z";

describe("inventory baseline reconciliation seam", () => {
  it("keeps unresolved exceptions blocked until an explicit decision is supplied", () => {
    const baseline = applyInventoryBaselineReconciliations(
      [
        { recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" },
        { recordId: "rec-good", item: "Rice", quantity: 1, unit: "kg" },
      ],
      BASELINE,
      [],
    );

    expect(baseline.events).toHaveLength(1);
    expect(baseline.reconciliations).toEqual([]);
    expect(baseline.unresolvedExceptions).toEqual([
      expect.objectContaining({ recordId: "rec-blank", code: "MISSING_QUANTITY" }),
    ]);
    expect(isReconciledBaselineReady(baseline)).toBe(false);
  });

  it("removes only explicitly quarantined exceptions from the unresolved set", () => {
    const baseline = applyInventoryBaselineReconciliations(
      [
        { recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" },
        { recordId: "rec-good", item: "Rice", quantity: 1, unit: "kg" },
      ],
      BASELINE,
      [
        {
          recordId: "rec-blank",
          disposition: "QUARANTINED_NON_STOCK",
          reason: "Human confirmed this record is not current stock.",
          evidence: "Explicit household reconciliation on 2026-08-14.",
        },
      ],
    );

    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]?.itemKey).toBe("Rice");
    expect(baseline.reconciliations).toEqual([
      expect.objectContaining({
        recordId: "rec-blank",
        disposition: "QUARANTINED_NON_STOCK",
      }),
    ]);
    expect(baseline.unresolvedExceptions).toEqual([]);
    expect(isReconciledBaselineReady(baseline)).toBe(true);
  });

  it("treats an explicit discard as auditable exclusion, never as stock", () => {
    const baseline = applyInventoryBaselineReconciliations(
      [{ recordId: "rec-old", item: "Custard", quantity: null, unit: "1" }],
      BASELINE,
      [
        {
          recordId: "rec-old",
          disposition: "DISCARDED",
          reason: "Human confirmed the opened out-of-date item is discarded.",
          evidence: "Explicit household reconciliation on 2026-08-14.",
        },
      ],
    );

    expect(baseline.events).toEqual([]);
    expect(baseline.reconciliations[0]).toMatchObject({
      recordId: "rec-old",
      disposition: "DISCARDED",
    });
    expect(baseline.unresolvedExceptions).toEqual([]);
  });

  it("rejects inferred or incomplete reconciliation decisions", () => {
    expect(() =>
      applyInventoryBaselineReconciliations(
        [{ recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" }],
        BASELINE,
        [
          {
            recordId: "rec-blank",
            disposition: "QUARANTINED_NON_STOCK",
            reason: "",
            evidence: "",
          },
        ],
      ),
    ).toThrow("requires reason and evidence");
  });

  it("rejects decisions for non-exception rows", () => {
    expect(() =>
      applyInventoryBaselineReconciliations(
        [{ recordId: "rec-good", item: "Rice", quantity: 1, unit: "kg" }],
        BASELINE,
        [
          {
            recordId: "rec-good",
            disposition: "DISCARDED",
            reason: "Human decision",
            evidence: "Explicit reconciliation",
          },
        ],
      ),
    ).toThrow("has no baseline exception");
  });

  it("is deterministic regardless of decision order", () => {
    const rows = [
      { recordId: "rec-b", item: "B", quantity: null, unit: "1" },
      { recordId: "rec-a", item: "A", quantity: null, unit: "1" },
    ];
    const decisions = [
      {
        recordId: "rec-a",
        disposition: "DISCARDED" as const,
        reason: "Discarded",
        evidence: "Explicit reconciliation",
      },
      {
        recordId: "rec-b",
        disposition: "QUARANTINED_NON_STOCK" as const,
        reason: "Not current stock",
        evidence: "Explicit reconciliation",
      },
    ];
    const a = applyInventoryBaselineReconciliations(rows, BASELINE, decisions);
    const b = applyInventoryBaselineReconciliations(rows, BASELINE, [...decisions].reverse());
    expect(a).toEqual(b);
    expect(a.baselineId).toBe(b.baselineId);
    expect(isReconciledBaselineReady(a)).toBe(true);
  });
});
