import { auditInventoryBaseline, buildInventoryBaseline } from "../src/lib/state-engine/inventory-baseline";

/**
 * Read-only baseline-manifest entry point.
 *
 * Accepts a JSON object on stdin:
 *   { "baselineTimestamp": "<ISO timestamp>", "rows": [...] }
 *
 * It invokes the canonical baseline builder and audit only. No Airtable or
 * Production writes are performed here.
 */

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const document = JSON.parse(input);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Expected a JSON object containing baselineTimestamp and rows");
    }
    const { baselineTimestamp, rows } = document;
    if (typeof baselineTimestamp !== "string") throw new Error("Expected baselineTimestamp to be an ISO date string");
    if (!Array.isArray(rows)) throw new Error("Expected rows to be a JSON array of InventoryBaselineRow records");

    const baseline = buildInventoryBaseline(rows, baselineTimestamp);
    const audit = auditInventoryBaseline(rows, baseline);
    process.stdout.write(JSON.stringify({ baseline, audit }, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
});
