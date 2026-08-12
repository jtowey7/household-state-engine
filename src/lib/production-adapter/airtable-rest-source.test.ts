/**
 * Contract tests for the real read-only Airtable connector.
 *
 * Every request is served by an injected fetch stub — no network call, no real
 * base, no real credentials. The stub returns rows shaped exactly like the real
 * HOUSEHOLD EVENTS schema.
 */

import { describe, expect, it } from "vitest";
import {
  AIRTABLE_ENV_KEYS,
  buildEventsUrl,
  buildWindowFormula,
  createAirtableRestRowSource,
  describeAirtableConnectivity,
  readOnlyFetch,
  resolveAirtableConfig,
  type FetchLike,
} from "./airtable-rest-source";
import { HOUSEHOLD_EVENT_FIELDS, createAirtableProductionPort } from "./airtable-port";
import { loadProductionState } from "./adapter";
import type { SourceScope } from "./types";

const config = {
  lovableApiKey: "test-lovable-key",
  connectionKey: "test-connection-key",
  baseId: "appTEST000000000",
  eventsTable: "HOUSEHOLD EVENTS",
};

const scope: SourceScope = {
  mode: "PRODUCTION_READ_ONLY",
  datasetId: "household-test",
  windowStart: "2026-08-10",
  windowEnd: "2026-08-16",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

const receiptRecord = {
  id: "recREAL001",
  fields: {
    "Event ID": "EVT-2026-08-11-0001",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T09:15:00.000Z",
    "Recorded at": "2026-08-11T09:20:00.000Z",
    Source: "Tesco order confirmation",
    Actor: "James",
    "Entity type": "Inventory item",
    "Entity reference": "INV-0042",
    Item: "tesco-6-boneless-salmon-fillets-780g",
    "Quantity delta": 780,
    Unit: "g",
    Evidence: "Delivery note",
    "State before": "0",
    "State after": "780",
    Confidence: "High",
    "Replay status": "Pending",
    "Record class": "Production",
  },
};

function stubFetch(pages: unknown[]): { fetchImpl: FetchLike; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  let page = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    const body = pages[Math.min(page, pages.length - 1)];
    page += 1;
    return jsonResponse(body);
  };
  return { fetchImpl, calls };
}

describe("Airtable connector configuration boundary", () => {
  it("reports NOT_CONFIGURED with the exact missing keys and never throws", () => {
    const resolution = resolveAirtableConfig({});
    expect(resolution.status).toBe("NOT_CONFIGURED");
    expect(resolution.config).toBeNull();
    expect(resolution.missing).toEqual([
      AIRTABLE_ENV_KEYS.lovableApiKey,
      AIRTABLE_ENV_KEYS.connectionKey,
      AIRTABLE_ENV_KEYS.baseId,
      AIRTABLE_ENV_KEYS.eventsTable,
    ]);
    expect(describeAirtableConnectivity(resolution)).toMatch(/NOT configured/);
  });

  it("treats blank/whitespace values as absent rather than valid credentials", () => {
    const resolution = resolveAirtableConfig({
      [AIRTABLE_ENV_KEYS.lovableApiKey]: "  ",
      [AIRTABLE_ENV_KEYS.connectionKey]: "k",
      [AIRTABLE_ENV_KEYS.baseId]: "appX",
      [AIRTABLE_ENV_KEYS.eventsTable]: "HOUSEHOLD EVENTS",
    });
    expect(resolution.status).toBe("NOT_CONFIGURED");
    expect(resolution.missing).toEqual([AIRTABLE_ENV_KEYS.lovableApiKey]);
  });

  it("resolves a complete configuration without mutating or inventing values", () => {
    const resolution = resolveAirtableConfig({
      [AIRTABLE_ENV_KEYS.lovableApiKey]: "lk",
      [AIRTABLE_ENV_KEYS.connectionKey]: "ck",
      [AIRTABLE_ENV_KEYS.baseId]: "appX",
      [AIRTABLE_ENV_KEYS.eventsTable]: "HOUSEHOLD EVENTS",
    });
    expect(resolution).toEqual({
      status: "CONFIGURED",
      missing: [],
      config: { lovableApiKey: "lk", connectionKey: "ck", baseId: "appX", eventsTable: "HOUSEHOLD EVENTS" },
    });
  });
});

describe("Airtable read-only request construction", () => {
  it("requests exactly the real HOUSEHOLD EVENTS field names and nothing else", () => {
    const url = buildEventsUrl(config, scope);
    const params = new URL(url).searchParams;
    expect(params.getAll("fields[]")).toEqual([...HOUSEHOLD_EVENT_FIELDS]);
  });

  it("scopes the read to the requested window", () => {
    const formula = buildWindowFormula(scope);
    expect(formula).toContain("Occurred at");
    expect(formula).toContain(scope.windowStart);
    expect(formula).toContain(scope.windowEnd);
    expect(buildEventsUrl(config, scope)).toContain(encodeURIComponent(config.baseId));
  });

  it("does NOT filter Record class upstream — exclusion stays provable in replay", () => {
    expect(buildWindowFormula(scope)).not.toContain("Record class");
  });

  it("issues GET only", async () => {
    const { fetchImpl, calls } = stubFetch([{ records: [receiptRecord] }]);
    const source = createAirtableRestRowSource({ config, fetchImpl });
    await source.listEventRows(scope);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("refuses any non-GET call through the read-only fetch guard", async () => {
    const guarded = readOnlyFetch(async () => jsonResponse({ records: [] }));
    await expect(guarded("https://example.invalid", { method: "POST" })).rejects.toThrow(
      /production writes are disabled/i,
    );
    await expect(guarded("https://example.invalid", { method: "DELETE" })).rejects.toThrow(
      /production writes are disabled/i,
    );
  });

  it("exposes no write member on the source object", () => {
    const { fetchImpl } = stubFetch([{ records: [] }]);
    const source = createAirtableRestRowSource({ config, fetchImpl }) as unknown as Record<string, unknown>;
    for (const member of ["create", "update", "delete", "destroy", "upsert", "patch"]) {
      expect(typeof source[member]).not.toBe("function");
    }
  });
});

describe("Airtable read-only response handling", () => {
  it("follows pagination and returns every record with its verbatim record id", async () => {
    const second = { ...receiptRecord, id: "recREAL002", fields: { ...receiptRecord.fields, "Event ID": "EVT-2026-08-11-0002" } };
    const { fetchImpl, calls } = stubFetch([
      { records: [receiptRecord], offset: "itrPAGE2" },
      { records: [second] },
    ]);
    const source = createAirtableRestRowSource({ config, fetchImpl });
    const rows = await source.listEventRows(scope);
    expect(rows.map((r) => r.id)).toEqual(["recREAL001", "recREAL002"]);
    expect(calls[1]?.url).toContain("offset=itrPAGE2");
  });

  it("surfaces the provider status and body on a failed read instead of falling back", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 403,
      async text() {
        return '{"error":{"type":"INVALID_PERMISSIONS"}}';
      },
      async json() {
        return {};
      },
    });
    const source = createAirtableRestRowSource({ config, fetchImpl });
    await expect(source.listEventRows(scope)).rejects.toThrow(/\[403\].*INVALID_PERMISSIONS/s);
  });

  it("refuses a response with no records array rather than reading an empty household", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ notRecords: [] });
    const source = createAirtableRestRowSource({ config, fetchImpl });
    await expect(source.listEventRows(scope)).rejects.toThrow(/records/i);
  });

  it("refuses a record missing its record id rather than reading partial state", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ records: [{ fields: receiptRecord.fields }] });
    const source = createAirtableRestRowSource({ config, fetchImpl });
    await expect(source.listEventRows(scope)).rejects.toThrow(/record id/i);
  });
});

describe("Airtable connector through the production port", () => {
  it("maps a fetched Delivery row into a positive stock delta with verbatim Event ID", async () => {
    const { fetchImpl } = stubFetch([{ records: [receiptRecord] }]);
    const port = createAirtableProductionPort({
      source: createAirtableRestRowSource({ config, fetchImpl }),
      mode: "PRODUCTION_READ_ONLY",
    });
    const loaded = await loadProductionState(port, scope);
    expect(loaded.ok).toBe(true);
    expect(loaded.writable).toBe(false);
    expect(loaded.openingEvents).toHaveLength(1);
    expect(loaded.openingEvents[0]?.eventId).toBe("EVT-2026-08-11-0001");
    expect(loaded.openingEvents[0]?.payload).toEqual({ quantity: 780, unit: "g" });
    expect(loaded.openingEvents[0]?.eventId).not.toBe("recREAL001");
  });

  it("returns zero demand targets — Airtable supplies state, not par levels", async () => {
    const { fetchImpl } = stubFetch([{ records: [receiptRecord] }]);
    const port = createAirtableProductionPort({
      source: createAirtableRestRowSource({ config, fetchImpl }),
      mode: "PRODUCTION_READ_ONLY",
    });
    const loaded = await loadProductionState(port, scope);
    expect(loaded.targets).toEqual([]);
    expect(loaded.ok).toBe(true);
  });

  it("propagates a connector failure as a fatal, non-silent read", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };
    const port = createAirtableProductionPort({
      source: createAirtableRestRowSource({ config, fetchImpl }),
      mode: "PRODUCTION_READ_ONLY",
    });
    const loaded = await loadProductionState(port, scope);
    expect(loaded.ok).toBe(false);
    expect(loaded.openingEvents).toEqual([]);
    expect(loaded.rejections.some((r) => r.fatal)).toBe(true);
  });

  it("is deterministic across repeated reads of the same rows", async () => {
    const build = async () => {
      const { fetchImpl } = stubFetch([{ records: [receiptRecord] }]);
      const port = createAirtableProductionPort({
        source: createAirtableRestRowSource({ config, fetchImpl }),
        mode: "PRODUCTION_READ_ONLY",
      });
      return loadProductionState(port, scope);
    };
    const [a, b] = await Promise.all([build(), build()]);
    expect(a.sourceId).toBe(b.sourceId);
  });
});
