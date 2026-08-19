import { describe, expect, it, vi } from "vitest";

import { buildLiveBaselineManifest } from "./live-baseline-manifest";

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

describe("canonical production baseline append identity", () => {
  it("keeps canonical Event IDs, payload hashes and batch fingerprint stable while Occurred at changes", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = airtableFetch();
      vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
      const first = await buildLiveBaselineManifest(env, fetchImpl);

      vi.setSystemTime(new Date("2026-08-19T12:05:00.000Z"));
      const second = await buildLiveBaselineManifest(env, fetchImpl);

      expect(first.snapshotFingerprint).toBe(second.snapshotFingerprint);
      expect(first.baselineId).toBe(second.baselineId);
      expect(first.reconciledBaselineId).toBe(second.reconciledBaselineId);
      expect(first.batchFingerprint).toBe(second.batchFingerprint);
      expect(first.baselineTimestamp).not.toBe(second.baselineTimestamp);
      expect(first.reconciledReady).toBe(true);
      expect(first.eventCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
