import { describe, expect, it, vi } from "vitest";

import { buildLiveBaselineManifest } from "./live-baseline-manifest";
import { readOnlyFetch } from "./airtable-rest-source";

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
    expect(first.batchFingerprint).toBeTruthy();
    expect(first.snapshotFingerprint).toBe(second.snapshotFingerprint);
    expect(first.baselineId).not.toBe(second.baselineId);
    expect(first.batchFingerprint).not.toBe(second.batchFingerprint);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  // Airtable REST adapters may expose fields by immutable field ID; the manifest must preserve the same evidence semantics.
  it("accepts Airtable responses keyed by immutable field IDs", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: { method?: string }) => {
      expect(init?.method).toBe("GET");
      if (input.includes("tblN5ZnsivyfIQKnE")) {
        return response({
          records: [
            {
              id: "rectZICO6MDJ5ftyn",
              fields: {
                fld58iyqxlpG04WGN: "Frozen ginger",
                fldAtqN53EWTGsYBH: 100,
                fldNAS3ubie509gtt: "g",
                fld827WKdtfBVP5fT: "OK",
                fldkI4brbFEppTgW3: "Freezer 2. Approximate quantity.",
              },
            },
          ],
        });
      }
      if (input.includes("tbl42NyhXosHPiCpX")) {
        return response({
          records: [
            {
              id: "recReconFrozenGinger",
              fields: {
                fldzwJl3oMkaGKSLC: "rectZICO6MDJ5ftyn",
                flde1REBRL629ubxe: "CONFIRM_RECORDED_QUANTITY",
                fldjNfmYDaRNUkkWv: "Explicit household confirmation",
                fldwwFWQTl2K5dIdS: "Human-confirmed recorded quantity",
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${input}`);
    });

    const manifest = await buildLiveBaselineManifest(
      {
        AIRTABLE_API_KEY: "test-key",
        AIRTABLE_FOOD_OS_BASE_ID: "appmqDptH3taN8uby",
        AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "tbluib6LxfFge36qE",
      },
      fetchImpl,
    );

    expect(manifest.inventoryRecordCount).toBe(1);
    expect(manifest.reconciliationDecisionCount).toBe(1);
    expect(manifest.unresolvedExceptionCount).toBe(0);
    expect(manifest.reconciledReady).toBe(true);
    expect(manifest.eventCount).toBe(1);
    expect(manifest.batchFingerprint).toBeTruthy();
  });

  it("refuses a non-GET request at the Airtable transport boundary", async () => {
    const inner = vi.fn(async () => response({ records: [] }));
    const safeFetch = readOnlyFetch(inner);

    await expect(safeFetch("https://example.test", { method: "POST" })).rejects.toThrow(
      "Read-only Airtable connector refused a POST request",
    );
    expect(inner).not.toHaveBeenCalled();
  });
});
