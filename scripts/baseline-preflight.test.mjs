import { describe, expect, it } from "vitest";
import { classifyBaselinePreflight } from "./baseline-preflight.mjs";

describe("classifyBaselinePreflight", () => {
  const proven = {
    ok: true,
    mode: "READ_ONLY",
    inventoryRecordCount: 228,
    reconciliationDecisionCount: 30,
    reconciledReady: true,
    unresolvedExceptionCount: 0,
    snapshotFingerprint: "sha256:snapshot",
    baselineId: "BASELINE-1",
    reconciledBaselineId: "BASELINE-1",
    eventCount: 210,
    itemUnitGroupCount: 95,
  };

  it("returns sanitized PROVEN evidence for the approved shape", () => {
    expect(classifyBaselinePreflight(proven)).toEqual({
      status: "PROVEN",
      ok: true,
      mode: "READ_ONLY",
      inventoryRecordCount: 228,
      reconciliationDecisionCount: 30,
      snapshotFingerprint: "sha256:snapshot",
      baselineId: "BASELINE-1",
      reconciledBaselineId: "BASELINE-1",
      eventCount: 210,
      itemUnitGroupCount: 95,
      unresolvedExceptionCount: 0,
      reconciledReady: true,
    });
  });

  it("classifies the known Airtable 401 as an external blocker", () => {
    expect(
      classifyBaselinePreflight({
        ok: false,
        mode: "READ_ONLY",
        error: "Airtable read failed [401]: invalid token",
      }),
    ).toEqual({
      status: "EXTERNAL_BLOCKED",
      mode: "READ_ONLY",
      error: "Airtable read failed [401]: invalid token",
    });
  });

  it("keeps the narrow 403 classification", () => {
    expect(
      classifyBaselinePreflight({
        ok: false,
        mode: "READ_ONLY",
        error: "Airtable read failed [403]: INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND",
      }).status,
    ).toBe("EXTERNAL_BLOCKED");
  });

  it("rejects a successful manifest with the wrong inventory count", () => {
    expect(() => classifyBaselinePreflight({ ...proven, inventoryRecordCount: 227 })).toThrow(
      "Expected 228 inventory records, got 227",
    );
  });

  it("does not swallow unrelated failures", () => {
    expect(() =>
      classifyBaselinePreflight({ ok: false, mode: "READ_ONLY", error: "unexpected upstream failure" }),
    ).toThrow("Live baseline connector preflight failed: unexpected upstream failure");
  });
});
