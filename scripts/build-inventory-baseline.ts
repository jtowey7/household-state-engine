import { buildInventoryBaseline } from "../src/lib/inventoryBaseline";

/**
 * Read-only baseline-manifest entry point.
 *
 * This deliberately accepts a canonical InventoryRow JSON document from stdin
 * rather than reaching into production itself. The caller is responsible for
 * obtaining the exact live snapshot through the approved read-only connector.
 * No writes are performed here.
 */

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const rows = JSON.parse(input);
    if (!Array.isArray(rows)) throw new Error("Expected a JSON array of InventoryRow records");
    const baseline = buildInventoryBaseline(rows);
    process.stdout.write(JSON.stringify(baseline, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
});
