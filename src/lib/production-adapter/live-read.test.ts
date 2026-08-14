import { describe, expect, it } from "vitest";

import { readLiveHouseholdSummary } from "./live-read";
import { describeHouseholdSource } from "../dev-control/source-banner";
import type { AirtableRow, AirtableRowSource } from "./airtable-port";

const scope = {
  datasetId: "household",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

const rows: AirtableRow[] = [
  {
    id: "recAAA",
    fields: {
      "Event ID": "EVT-1001",
      "Event type": "Receipt",
      "Occurred at": "2026-08-01T06:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 1000,
      Unit: "g",
      "Record class": "Production",
    },
  },
  {
    id: "recBBB",
    fields: {
      "Event ID": "EVT-1002",
      "Event type": "Consumption",
      "Occurred at": "2026-08-02T18:30:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 250,
      Unit: "g",
      "Record class": "Production",
    },
  },
];

/** Stands in for the real GET-only connector: production-labelled provenance. */
function connectorSource(overrides: Partial<AirtableRowSource> = {}): AirtableRowSource {
  return {
    baseLabel: "airtable:baseX/HOUSEHOLD EVENTS",
    provenance: "airtable read-only GET baseX/HOUSEHOLD EVENTS via connector gateway",
    listEventRows: async () => rows,
    ...overrides,
  } as AirtableRowSource;
}

const CONFIGURED_ENV = {
  LOVABLE_API_KEY: "k",
  AIRTABLE_API_KEY: "c",
  AIRTABLE_FOOD_OS_BASE_ID: "baseX",
  AIRTABLE_HOUSEHOLD_EVENTS_TABLE: "HOUSEHOLD EVENTS",
};

describe("live household read — configured / not-configured boundary", () => {
  it("reports NOT_CONFIGURED with the exact missing keys and reads nothing", async () => {
    const read = await readLiveHouseholdSummary({ scope, env: {} });
    expect(read.status).toBe("NOT_CONFIGURED");
    expect(read.summary).toBeNull();
    expect(read.missing).toEqual([
      "LOVABLE_API_KEY",
      "AIRTABLE_API_KEY",
      "AIRTABLE_FOOD_OS_BASE_ID",
      "AIRTABLE_HOUSEHOLD_EVENTS_TABLE",
    ]);
  });

  it("reports NOT_CONFIGURED when configuration is only partial", async () => {
    const read = await readLiveHouseholdSummary({
      scope,
      env: { LOVABLE_API_KEY: "k", AIRTABLE_API_KEY: "c" },
    });
    expect(read.status).toBe("NOT_CONFIGURED");
    expect(read.missing).toEqual([
      "AIRTABLE_FOOD_OS_BASE_ID",
      "AIRTABLE_HOUSEHOLD_EVENTS_TABLE",
    ]);
  });

  it("never issues a network call when unconfigured", async () => {
    let calls = 0;
    const read = await readLiveHouseholdSummary({
      scope,
      env: {},
      fetchImpl: async () => {
        calls += 1;
        throw new Error("network must not be touched");
      },
    });
    expect(calls).toBe(0);
    expect(read.status).toBe("NOT_CONFIGURED");
  });

  it("summarises a configured read-only connector read without exposing rows", async () => {
    const read = await readLiveHouseholdSummary({
      scope,
      env: CONFIGURED_ENV,
      sourceOverride: connectorSource(),
    });
    expect(read.status).toBe("LIVE");
    if (read.status !== "LIVE") return;
    expect(read.summary.eventCount).toBe(2);
    expect(read.summary.writable).toBe(false);
    expect(JSON.stringify(read.summary)).not.toContain("oats-rolled");
    expect(JSON.stringify(read)).not.toContain(CONFIGURED_ENV.AIRTABLE_API_KEY);
  });

  it("is deterministic for the same source rows", async () => {
    const a = await readLiveHouseholdSummary({ scope, env: CONFIGURED_ENV, sourceOverride: connectorSource() });
    const b = await readLiveHouseholdSummary({ scope, env: CONFIGURED_ENV, sourceOverride: connectorSource() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports READ_FAILED verbatim instead of falling back to fixtures", async () => {
    const read = await readLiveHouseholdSummary({
      scope,
      env: CONFIGURED_ENV,
      sourceOverride: connectorSource({
        listEventRows: async () => {
          throw new Error("gateway 503");
        },
      }),
    });
    expect(read.status).toBe("READ_FAILED");
    expect(read.detail).toContain("gateway 503");
    expect(read.summary).toBeNull();
  });

  it("refuses synthetic provenance offered as live household state", async () => {
    const read = await readLiveHouseholdSummary({
      scope,
      env: CONFIGURED_ENV,
      sourceOverride: connectorSource({ provenance: "synthetic fixture — fake Airtable row source" }),
    });
    expect(read.status).toBe("READ_FAILED");
    expect(read.detail).toContain("PROVENANCE_CONTAMINATION");
  });
});

describe("household source banner projection", () => {
  it("marks dashboard figures as synthetic when the connector is unconfigured", async () => {
    const view = describeHouseholdSource(await readLiveHouseholdSummary({ scope, env: {} }));
    expect(view.mode).toBe("NOT_CONFIGURED");
    expect(view.syntheticFigures).toBe(true);
    expect(view.facts.join(" ")).toContain("AIRTABLE_API_KEY");
    expect(view.facts.join(" ")).toContain("synthetic harness");
  });

  it("marks figures as live only after a successful production read", async () => {
    const view = describeHouseholdSource(
      await readLiveHouseholdSummary({ scope, env: CONFIGURED_ENV, sourceOverride: connectorSource() }),
    );
    expect(view.mode).toBe("LIVE");
    expect(view.syntheticFigures).toBe(false);
    expect(view.badge).toContain("READ-ONLY");
  });

  it("does not claim live data when a configured read fails", async () => {
    const view = describeHouseholdSource(
      await readLiveHouseholdSummary({
        scope,
        env: CONFIGURED_ENV,
        sourceOverride: connectorSource({
          listEventRows: async () => {
            throw new Error("gateway 503");
          },
        }),
      }),
    );
    expect(view.mode).toBe("READ_FAILED");
    expect(view.syntheticFigures).toBe(true);
  });
});
