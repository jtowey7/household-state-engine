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

describe("live baseline manifest", () => {
  it("builds a read-only reconciled manifest from Airtable rows and fingerprints the raw snapshot", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: { method?: string }) => {
      expect(init?.method).toBe("GET");
      if (input.includes("tblN5ZnsivyfIQKnE")) {
        return response({
          records: [
            {
              id: "recOats1234567890",
              fields: { Item: "Oats", Quantity: 1200, Unit: "g", Status: "In", Notes: "" },
            },
            {
              id: "recMilk1234567890",
              fields: { Item: "Milk", Quantity: 2, Unit: "pint", Status: "In", Notes: "opened" },
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
                "Inventory record ID": "recMilk1234567890",
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

    const env = {
      AIRTABLE_API_KEY: "test-key",
      AIRTABLE_FOOD_OS_BASE_ID: "appmqDptH3taN8uby",
      AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "tbluib6LxfFge36qE",
    };

    const first = await buildLiveBaselineManifest(env, fetchImpl);
    const second = await buildLiveBaselineManifest(env, fetchImpl);

    expect(first.ok).toBe(true);
    expect(first.mode).toBe("READ_ONLY");
    expect(first.inventoryRecordCount).toBe(2);
    expect(first.reconciliationDecisionCount).toBe(1);
    expect(first.unresolvedExceptionCount).toBe(0);
    expect(first.reconciledReady).toBe(true);
    expect(first.eventCount).toBe(2);
    expect(first.snapshotFingerprint).toBe(second.snapshotFingerprint);
    expect(first.baselineId).not.toBe(second.baselineId);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses a non-GET fetch even though the manifest path is read-only", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: { method?: string }) => {
      expect(init?.method).toBe("POST");
      return response({ records: [] });
    });

    await expect(
      buildLiveBaselineManifest(
        {
          AIRTABLE_API_KEY: "test-key",
          AIRTABLE_FOOD_OS_BASE_ID: "appmqDptH3taN8uby",
          AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "tbluib6LxfFge36qE",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("Read-only Airtable connector refused a POST request");
  });
});
