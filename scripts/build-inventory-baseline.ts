import { auditInventoryBaseline, buildInventoryBaseline } from "../src/lib/state-engine/inventory-baseline";
import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
} from "../src/lib/state-engine/inventory-reconciliation";

/**
 * Read-only baseline-manifest entry point.
 *
 * Accepts a JSON object on stdin:
 *   {
 *     "baselineTimestamp": "<ISO timestamp>",
 *     "rows": [...],
 *     "reconciliations": [...] // optional durable control-plane decisions
 *   }
 *
 * When reconciliations are supplied, the script performs the same fresh-session
 * reconciliation consumption used by the production baseline gate and emits
 * both the raw audit and the reconciled readiness result.
 *
 * This entry point is strictly read-only. No Airtable or Production writes are
 * performed here.
 */

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const document = JSON.parse(input);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Expected a JSON object containing baselineTimestamp and rows");
    }
    const { baselineTimestamp, rows, reconciliations } = document as {
      baselineTimestamp?: unknown;
      rows?: unknown;
      reconciliations?: unknown;
    };
    if (typeof baselineTimestamp !== "string") {
      throw new Error("Expected baselineTimestamp to be an ISO date string");
    }
    if (!Array.isArray(rows)) {
      throw new Error("Expected rows to be a JSON array of InventoryBaselineRow records");
    }
    if (reconciliations !== undefined && !Array.isArray(reconciliations)) {
      throw new Error("Expected reconciliations to be a JSON array when supplied");
    }

    const baseline = buildInventoryBaseline(rows, baselineTimestamp);
    const audit = auditInventoryBaseline(rows, baseline);

    const output: Record<string, unknown> = { baseline, audit };
    if (Array.isArray(reconciliations)) {
      const reconciled = applyInventoryBaselineReconciliations(
        rows,
        baselineTimestamp,
        reconciliations as InventoryBaselineReconciliation[],
      );
      output.reconciledBaseline = reconciled;
      output.reconciledReady = isReconciledBaselineReady(reconciled);
      output.reconciledAudit = {
        ...auditInventoryBaseline(rows, reconciled),
        exceptionCount: reconciled.unresolvedExceptions.length,
        reconciledReady: isReconciledBaselineReady(reconciled),
        reconciliationDecisionCount: reconciled.reconciliations.length,
      };
    }

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
});
