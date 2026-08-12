import { describe, expect, it } from "vitest";

import {
  assertReadOnlySource,
  createAirtableProductionPort,
  createFakeAirtableRowSource,
  mapEventRow,
  mapTargetRow,
  loadProductionState,
  productionPortContract,
} from ".";
import type { AirtableRow, SourceScope } from ".";

const scope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "fake-airtable-base",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

const eventRows: AirtableRow[] = [
  {
    id: "recAAA",
    fields: {
      "Event ID": "EVT-1001",
      "Record Class": "Production",
      "Event Type": "ITEM_STOCK_SET",
      "Item Key": "oats-rolled",
      "Occurred At": "2026-08-01T06:00:00.000Z",
      Quantity: 1000,
      Unit: "g",
      "Airtable Formula Column": "ignored",
    },
  },
  {
    id: "recBBB",
    fields: {
      "Event ID": "EVT-1002",
      "Record Class": "Production",
      "Event Type": "ITEM_STOCK_SET",
      "Item Key": "milk-whole",
      "Occurred At": "2026-08-01T06:05:00.000Z",
      Quantity: 4,
      Unit: "L",
    },
  },
];

const targetRows: AirtableRow[] = [
  { id: "recT1", fields: { "Item Key": "oats-rolled", "Target Quantity": 2000, Unit: "g", "Pack Size": 500, "Pack Unit": "g" } },
  { id: "recT2", fields: { "Item Key": "milk-whole", "Target Quantity": 6, Unit: "L" } },
];

const port = (overrides: Partial<Parameters<typeof createFakeAirtableRowSource>[0]> = {}) =>
  createAirtableProductionPort({
    mode: "SYNTHETIC",
    source: createFakeAirtableRowSource({ eventRows, targetRows, ...overrides }),
  });

describe("airtable-backed production port (read-only boundary)", () => {
  it("maps a row to a canonical event with the immutable Event ID verbatim", () => {
    const event = mapEventRow(eventRows[0]!);
    expect(event.eventId).toBe("EVT-1001");
    expect(event.eventId).not.toBe("recAAA");
    expect(event.payload).toEqual({ quantity: 1000, unit: "g" });
    expect(Object.keys(event.payload)).not.toContain("Airtable Formula Column");
  });

  it("preserves Record Class = Test rather than rewriting it", () => {
    const event = mapEventRow({
      id: "recT",
      fields: { ...eventRows[0]!.fields, "Event ID": "EVT-TEST", "Record Class": "Test" },
    });
    expect(event.recordClass).toBe("Test");
  });

  it("carries supersession through from the source row", () => {
    const event = mapEventRow({
      id: "recS",
      fields: { ...eventRows[0]!.fields, "Event ID": "EVT-1003", Supersedes: ["EVT-1001"] },
    });
    expect(event.supersedes).toEqual(["EVT-1001"]);
  });

  it("maps demand targets including pack configuration", () => {
    expect(mapTargetRow(targetRows[0]!)).toEqual({
      itemKey: "oats-rolled",
      targetQuantity: 2000,
      unit: "g",
      packSize: 500,
      packUnit: "g",
    });
  });

  it("exposes no write path on the port or the source", () => {
    const p = port();
    expect("write" in p).toBe(false);
    expect("update" in p).toBe(false);
    expect(Object.keys(p).sort()).toEqual(["mode", "portId", "read"]);
  });

  it("refuses to build a port over a source that can mutate Airtable", () => {
    const writable = {
      ...createFakeAirtableRowSource({ eventRows, targetRows }),
      update: async () => undefined,
    };
    expect(() => assertReadOnlySource(writable)).toThrow(/write members/);
    expect(() => createAirtableProductionPort({ source: writable })).toThrow(/read-only/);
  });

  it("satisfies the shared production port contract", async () => {
    const result = await productionPortContract(port(), scope);
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("loads events and targets read-only", async () => {
    const load = await loadProductionState(port(), scope);
    expect(load.ok).toBe(true);
    expect(load.writable).toBe(false);
    expect(load.openingEvents.map((e) => e.eventId)).toEqual(["EVT-1001", "EVT-1002"]);
    expect(load.targets).toHaveLength(2);
  });

  it("quarantines malformed source rows without blocking unrelated items", async () => {
    const load = await loadProductionState(
      port({
        eventRows: [
          ...eventRows,
          { id: "recBAD", fields: { "Event ID": "EVT-BAD", "Item Key": "rice-basmati" } },
        ],
      }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.quarantinedItemKeys).toEqual(["rice-basmati"]);
    expect(load.openingEvents.map((e) => e.itemKey)).toEqual(["oats-rolled", "milk-whole"]);
  });

  it("quarantines a reused Event ID carrying a different payload", async () => {
    const load = await loadProductionState(
      port({
        eventRows: [
          ...eventRows,
          { id: "recDUP", fields: { ...eventRows[0]!.fields, Quantity: 9999 } },
        ],
      }),
      scope,
    );
    expect(load.rejections.map((r) => r.code)).toContain("DUPLICATE_EVENT_ID");
    expect(load.quarantinedItemKeys).toEqual(["oats-rolled"]);
  });

  it("reports an unavailable connector as a fatal rejection instead of throwing", async () => {
    const load = await loadProductionState(port({ failWith: "airtable 503" }), scope);
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("refuses a synthetic fake offered as production state", async () => {
    const lying = createAirtableProductionPort({
      mode: "PRODUCTION_READ_ONLY",
      source: createFakeAirtableRowSource({ eventRows, targetRows }),
    });
    const load = await loadProductionState(lying, { ...scope, mode: "PRODUCTION_READ_ONLY" });
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("PROVENANCE_CONTAMINATION");
  });

  it("is deterministic across identical reads", async () => {
    const a = await loadProductionState(port(), scope);
    const b = await loadProductionState(port(), scope);
    expect(b.sourceId).toBe(a.sourceId);
  });
});
