import { readLiveHouseholdSummary } from "../src/lib/production-adapter/live-read";

function readArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

const asOf = readArg("--as-of");
const baseId = readArg("--base");

if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  throw new Error(`--as-of must be YYYY-MM-DD, received ${asOf}`);
}

process.env.AIRTABLE_FOOD_OS_BASE_ID = baseId;
process.env.AIRTABLE_HOUSEHOLD_EVENTS_TABLE = "HOUSEHOLD EVENTS";

const result = await readLiveHouseholdSummary({
  scope: {
    datasetId: baseId,
    windowStart: "1970-01-01",
    windowEnd: asOf,
  },
});

if (result.status !== "LIVE") {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: result.status,
      detail: result.detail,
      asOf,
      baseId,
      summary: result.summary,
    },
    null,
    2,
  ),
);
