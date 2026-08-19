import { describe, expect, it, vi } from "vitest";
import { buildLiveBaselineManifest } from "../src/lib/production-adapter/live-baseline-manifest";
import { canonicalRecords } from "./execute-production-baseline";
import { batchFingerprintFor } from "../src/lib/event-writer/baseline-batch";

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as Response;
}

function airtableFetch() {
  return vi.fn(async (input: string) => {
    if (input.includes("tblN5ZnsivyfIQKnE")) {
      return response({
        records: [
          {
            id: "recOats1234567890",
            fields: { Item: "Oats", Quantity: 1200, Unit: "g", Status: "In", Notes: "" },
          },
        ],
      });
    }
    if (input.includes("tbl42NyhXosHPiCpX")) {
      return response({
        records: [
          {
            id: "recRecon123456789",
            fields: {
              "Inventory record ID": "recOats1234567890",
              Disposition: "CONFIRM_RECORDED_QUANTITY",
              Reason: "Explicit household confirmation",
              Evidence: "Human-confirmed recorded quantity",
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL: ${input}`);
  });
}

const env = {
  AIRTABLE_API_KEY: "test-key",
  AIRTABLE_FOOD_OS_BASE_ID: "appmqDptH3taN8uby",
  AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "tbluib6LxfFge36qE",
};

const inventoryRows = [
  { recordId: "recOats1234567890", item: "Oats", quantity: 1200, unit: "g", status: "In", notes: "" },
];

const reconciliationRows = [
  {
    id: "recRecon123456789",
    fields: {
      "Inventory record ID": "recOats1234567890",
      Disposition: "CONFIRM_RECORDED_QUANTITY",
      Reason: "Explicit household confirmation",
      Evidence: "Human-confirmed recorded quantity",
    },
  },
];

describe("production baseline manifest/execution canonical identity", () => {
  it("uses the same stable batch fingerprint across read-only manifest and execution", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = airtableFetch();
      vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
      const manifest = await buildLiveBaselineManifest(env, fetchImpl);

      const execution = canonicalRecords(inventoryRows, reconciliationRows, "2026-08-19T12:00:00.000Z");
      expect(batchFingerprintFor(execution.records)).toBe(manifest.batchFingerprint);

      vi.setSystemTime(new Date("2026-08-19T12:05:00.000Z"));
      const replayManifest = await buildLiveBaselineManifest(env, fetchImpl);
      const replayExecution = canonicalRecords(inventoryRows, reconciliationRows, "2026-08-19T12:05:00.000Z");

      expect(replayManifest.batchFingerprint).toBe(manifest.batchFingerprint);
      expect(batchFingerprintFor(replayExecution.records)).toBe(replayManifest.batchFingerprint);
    } finally {
      vi.useRealTimers();
    }
  });
});
