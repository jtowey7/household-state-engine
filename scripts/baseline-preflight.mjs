export function classifyBaselinePreflight(result) {
  if (result?.ok === true && result?.mode === "READ_ONLY") {
    if (result.inventoryRecordCount !== 228) {
      throw new Error(`Expected 228 inventory records, got ${result.inventoryRecordCount}`);
    }
    if (result.reconciliationDecisionCount !== 30) {
      throw new Error(`Expected 30 reconciliation decisions, got ${result.reconciliationDecisionCount}`);
    }
    if (result.reconciledReady !== true) {
      throw new Error(`Baseline is not reconciled-ready: ${result.unresolvedExceptionCount} unresolved exceptions`);
    }
    if (!result.snapshotFingerprint || !result.baselineId || !result.reconciledBaselineId || !result.batchFingerprint) {
      throw new Error("Missing deterministic baseline identity or batch authority");
    }

    return {
      status: "PROVEN",
      ok: result.ok,
      mode: result.mode,
      inventoryRecordCount: result.inventoryRecordCount,
      reconciliationDecisionCount: result.reconciliationDecisionCount,
      snapshotFingerprint: result.snapshotFingerprint,
      baselineId: result.baselineId,
      reconciledBaselineId: result.reconciledBaselineId,
      batchFingerprint: result.batchFingerprint,
      eventCount: result.eventCount,
      itemUnitGroupCount: result.itemUnitGroupCount,
      unresolvedExceptionCount: result.unresolvedExceptionCount,
      reconciledReady: result.reconciledReady,
    };
  }

  const error = result?.error ?? "unknown error";
  const airtable401 = error.includes("Airtable read failed [401]");
  const airtable403 =
    error.includes("Airtable read failed [403]") &&
    error.includes("INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND");

  if (airtable401 || airtable403) {
    return {
      status: "EXTERNAL_BLOCKED",
      mode: result?.mode ?? null,
      error,
    };
  }

  throw new Error(`Live baseline connector preflight failed: ${error}`);
}
