import { describe, expect, it } from "vitest";

import {
  assertReadOnlySource,
  createAirtableProductionPort,
  createFakeAirtableRowSource,
  mapHouseholdEventRow,
  mapHouseholdEventRows,
  loadProductionState,
  productionPortContract,
} from ".";
import type { AirtableRow, SourceScope } from ".";
import { replayEvents } from "../state-engine/engine";

/**
 * Fixtures are shaped EXACTLY like the real Airtable HOUSEHOLD EVENTS table:
 *   Event ID, Event type, Occurred at, Recorded at, Source, Actor, Entity type,
 *   Entity reference, Item, Quantity delta, Unit, Evidence, State before,
 *   State after, Confidence, Supersedes event ID,
 *   Exception / reconciliation action, Replay status, Record class
 * They are synthetic rows in the real shape — never real household data.
 */

const scope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "fake-airtable-base",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

function row(id: string, fields: Record<string, unknown>): AirtableRow {
  return { id, fields };
}

const receiptRow = row("recAAA", {
  "Event ID": "EVT-1001",
  "Event type": "Receipt",
  "Occurred at": "2026-08-01T06:00:00.000Z",
  "Recorded at": "2026-08-01T06:02:00.000Z",
  Source: "Tesco order confirmation",
  Actor: "James",
  "Entity type": "Inventory item",
  "Entity reference": "INV-0042",
  Item: "oats-rolled",
  "Quantity delta": 1000,
  Unit: "g",
  Evidence: "receipt-8871.pdf",
  "State before": "0",
  "State after": "1000",
  Confidence: "High",
  "Supersedes event ID": "",
  "Exception / reconciliation action": "",
  "Replay status": "Applied",
  "Record class": "Production",
  "Some Formula Column": "ignored entirely",
});

const consumptionRow = row("recBBB", {
  "Event ID": "EVT-1002",
  "Event type": "Consumption",
  "Occurred at": "2026-08-02T18:30:00.000Z",
  "Recorded at": "2026-08-02T18:35:00.000Z",
  Source: "Meal plan completion",
  Actor: "Household",
  Item: "oats-rolled",
  "Quantity delta": 250,
  Unit: "g",
  Evidence: "meal:2026-08-02-breakfast",
  Confidence: "High",
  "Record class": "Production",
});

const testClassRow = row("recCCC", {
  "Event ID": "EVT-9001",
  "Event type": "Receipt",
  "Occurred at": "2026-08-02T09:00:00.000Z",
  Item: "oats-rolled",
  "Quantity delta": 5000,
  Unit: "g",
  "Record class": "Test",
});

const eventRows: AirtableRow[] = [receiptRow, consumptionRow];

const port = (overrides: Partial<Parameters<typeof createFakeAirtableRowSource>[0]> = {}) =>
  createAirtableProductionPort({
    mode: "SYNTHETIC",
    source: createFakeAirtableRowSource({ eventRows, ...overrides }),
  });

describe("HOUSEHOLD EVENTS row mapping (real Airtable contract)", () => {
  it("maps a Production Receipt to a positive stock delta with verbatim Event ID", () => {
    const mapped = mapHouseholdEventRow(receiptRow);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.event).toEqual({
      eventId: "EVT-1001",
      recordClass: "Production",
      eventType: "ITEM_STOCK_DELTA",
      itemKey: "oats-rolled",
      occurredAt: "2026-08-01T06:00:00.000Z",
      payload: { quantity: 1000, unit: "g" },
    });
    // The Airtable record id is never used as the Event ID.
    expect(mapped.event.eventId).not.toBe(receiptRow.id);
  });

  it("maps a Production Consumption to a negative stock delta", () => {
    const mapped = mapHouseholdEventRow(consumptionRow);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.event.eventType).toBe("ITEM_STOCK_DELTA");
    expect(mapped.event.payload.quantity).toBe(-250);
  });

  it("maps Disposal to a negative delta and never flips its sign on re-map", () => {
    const disposal = mapHouseholdEventRow(
      row("recD", {
        "Event ID": "EVT-1010",
        "Event type": "Disposal",
        "Occurred at": "2026-08-03T10:00:00.000Z",
        Item: "milk-whole",
        "Quantity delta": -1,
        Unit: "L",
        "Record class": "Production",
      }),
    );
    expect(disposal.ok).toBe(true);
    if (!disposal.ok) return;
    expect(disposal.event.payload.quantity).toBe(-1);
  });

  it("preserves Record class = Test verbatim so the State Engine excludes it", () => {
    const mapped = mapHouseholdEventRow(testClassRow);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.event.recordClass).toBe("Test");

    const receipt = mapHouseholdEventRow(receiptRow);
    if (!receipt.ok) throw new Error("receipt fixture must map");
    const snapshot = replayEvents([receipt.event, mapped.event]);
    expect(snapshot.items[0]!.quantity).toBe(1000);
    expect(snapshot.exceptions.some((e) => e.code === "TEST_RECORD_EXCLUDED")).toBe(true);
  });

  it("carries `Supersedes event ID` through as supersession provenance", () => {
    const mapped = mapHouseholdEventRow(
      row("recS", {
        "Event ID": "EVT-1003",
        "Event type": "Correction",
        "Occurred at": "2026-08-03T08:00:00.000Z",
        Item: "oats-rolled",
        "State after": 640,
        Unit: "g",
        Evidence: "kitchen scale photo",
        "Supersedes event ID": ["EVT-1002"],
        "Record class": "Production",
      }),
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.event.eventType).toBe("ITEM_STOCK_SET");
    expect(mapped.event.payload.quantity).toBe(640);
    expect(mapped.event.supersedes).toEqual(["EVT-1002"]);
    expect(mapped.provenance.supersedesEventId).toEqual(["EVT-1002"]);
  });

  it("refuses a Correction with no numeric `State after` instead of guessing", () => {
    const mapped = mapHouseholdEventRow(
      row("recS2", {
        "Event ID": "EVT-1004",
        "Event type": "Correction",
        "Occurred at": "2026-08-03T08:00:00.000Z",
        Item: "oats-rolled",
        "State before": "1000",
        Unit: "g",
        "Record class": "Production",
      }),
    );
    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.code).toBe("UNMAPPABLE_CORRECTION");
    expect(mapped.kind).toBe("INVALID");
  });

  it.each(["Confirmation", "Transfer", "Substitution", "Unavailable", "Other"])(
    "never converts %s into a stock change",
    (type) => {
      const mapped = mapHouseholdEventRow(
        row(`rec-${type}`, {
          "Event ID": `EVT-${type}`,
          "Event type": type,
          "Occurred at": "2026-08-04T08:00:00.000Z",
          Item: "oats-rolled",
          "Quantity delta": 900,
          Unit: "g",
          "Record class": "Production",
        }),
      );
      expect(mapped.ok).toBe(false);
      if (mapped.ok) return;
      expect(mapped.code).toBe("UNSUPPORTED_EVENT_TYPE");
      expect(mapped.kind).toBe("UNSUPPORTED");
      expect(mapped.provenance?.eventTypeRaw).toBe(type);
    },
  );

  it("never invents a quantity or a unit", () => {
    const noQty = mapHouseholdEventRow(
      row("recQ", {
        "Event ID": "EVT-2001",
        "Event type": "Receipt",
        "Occurred at": "2026-08-04T08:00:00.000Z",
        Item: "milk-whole",
        Unit: "L",
        "Record class": "Production",
      }),
    );
    const noUnit = mapHouseholdEventRow(
      row("recU", {
        "Event ID": "EVT-2002",
        "Event type": "Receipt",
        "Occurred at": "2026-08-04T08:00:00.000Z",
        Item: "milk-whole",
        "Quantity delta": 2,
        "Record class": "Production",
      }),
    );
    expect(noQty.ok).toBe(false);
    expect(noUnit.ok).toBe(false);
    if (!noQty.ok) expect(noQty.code).toBe("MISSING_QUANTITY_DELTA");
    if (!noUnit.ok) expect(noUnit.code).toBe("MISSING_UNIT");
  });

  it("quarantines malformed rows with explicit codes", () => {
    const batch = mapHouseholdEventRows([
      row("recBad1", { "Event type": "Receipt", Item: "x", "Record class": "Production" }),
      row("recBad2", {
        "Event ID": "EVT-3001",
        "Event type": "Teleport",
        Item: "x",
        "Record class": "Production",
      }),
      row("recBad3", {
        "Event ID": "EVT-3002",
        "Event type": "Receipt",
        Item: "x",
        "Quantity delta": 1,
        Unit: "kg",
        "Record class": "Unknown",
      }),
      row("recBad4", {
        "Event ID": "EVT-3003",
        "Event type": "Receipt",
        "Quantity delta": 1,
        Unit: "kg",
        "Record class": "Production",
      }),
    ]);
    expect(batch.events).toHaveLength(0);
    expect(batch.invalid.map((r) => r.code)).toEqual([
      "MISSING_EVENT_ID",
      "INVALID_EVENT_TYPE",
      "INVALID_RECORD_CLASS",
      "MISSING_ITEM",
    ]);
  });

  it("REGRESSION: rejects the old invented field names rather than accepting them", () => {
    const legacy = mapHouseholdEventRow(
      row("recLegacy", {
        "Event ID": "EVT-LEGACY",
        "Record Class": "Production",
        "Event Type": "ITEM_STOCK_SET",
        "Item Key": "oats-rolled",
        "Occurred At": "2026-08-01T06:00:00.000Z",
        Quantity: 1000,
        Unit: "g",
        Note: "old shape",
        Supersedes: "EVT-0001",
      }),
    );
    expect(legacy.ok).toBe(false);
    if (legacy.ok) return;
    expect(legacy.code).toBe("LEGACY_FIELD_SCHEMA");
    expect(legacy.detail).toMatch(/Item Key/);
  });

  it("preserves exact provenance without folding it into event identity", () => {
    const mapped = mapHouseholdEventRow(receiptRow);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.provenance).toEqual({
      airtableRecordId: "recAAA",
      eventTypeRaw: "Receipt",
      recordedAt: "2026-08-01T06:02:00.000Z",
      source: "Tesco order confirmation",
      actor: "James",
      entityType: "Inventory item",
      entityReference: "INV-0042",
      evidence: "receipt-8871.pdf",
      stateBefore: "0",
      stateAfter: "1000",
      confidence: "High",
      exceptionAction: null,
      replayStatus: "Applied",
      supersedesEventId: [],
    });
    // Provenance stays out of the canonical payload (payload = event identity).
    expect(Object.keys(mapped.event.payload).sort()).toEqual(["quantity", "unit"]);
  });
});

describe("airtable-backed production port (read-only boundary)", () => {
  it("refuses a source that exposes any write member", () => {
    const writable = {
      ...createFakeAirtableRowSource({ eventRows }),
      update: async () => undefined,
    };
    expect(() => assertReadOnlySource(writable)).toThrow(/read-only/);
    expect(() => createAirtableProductionPort({ source: writable })).toThrow(/read-only/);
  });

  it("exposes read() only — no write path back into Airtable", () => {
    const p = port();
    expect(Object.keys(p).sort()).toEqual(["mode", "portId", "read"]);
  });

  it("loads mapped production events read-only", async () => {
    const load = await loadProductionState(port(), scope);
    expect(load.ok).toBe(true);
    expect(load.writable).toBe(false);
    expect(load.openingEvents.map((e) => e.eventId)).toEqual(["EVT-1001", "EVT-1002"]);
    expect(load.eventProvenance["EVT-1001"]).toBeDefined();
  });

  it("REGRESSION: needs no target/par-level rows from Airtable", async () => {
    const load = await loadProductionState(port(), scope);
    expect(load.ok).toBe(true);
    expect(load.targets).toEqual([]);
    // The read-only source boundary has no target-listing member at all.
    expect("listTargetRows" in createFakeAirtableRowSource({ eventRows })).toBe(false);
  });

  it("is idempotent for a duplicate Event ID with an identical payload", async () => {
    const load = await loadProductionState(
      port({ eventRows: [...eventRows, receiptRow] }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.openingEvents.filter((e) => e.eventId === "EVT-1001")).toHaveLength(1);
    expect(load.quarantinedItemKeys).toEqual([]);
  });

  it("blocks a reused Event ID carrying a changed payload", async () => {
    const conflicting = row("recDUP", {
      ...receiptRow.fields,
      "Quantity delta": 4000,
    });
    const load = await loadProductionState(
      port({ eventRows: [...eventRows, conflicting] }),
      scope,
    );
    expect(load.rejections.map((r) => r.code)).toContain("DUPLICATE_EVENT_ID");
    expect(load.quarantinedItemKeys).toContain("oats-rolled");
    expect(load.openingEvents.some((e) => e.itemKey === "oats-rolled")).toBe(false);
  });

  it("keeps unsupported real event types visible without quarantining the item", async () => {
    const load = await loadProductionState(
      port({
        eventRows: [
          ...eventRows,
          row("recConf", {
            "Event ID": "EVT-4001",
            "Event type": "Confirmation",
            "Occurred at": "2026-08-03T08:00:00.000Z",
            Item: "oats-rolled",
            "Record class": "Production",
          }),
        ],
      }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.rejections.map((r) => r.code)).toContain("UNSUPPORTED_EVENT_TYPE");
    expect(load.quarantinedItemKeys).toEqual([]);
    expect(load.openingEvents.some((e) => e.itemKey === "oats-rolled")).toBe(true);
  });

  it("quarantines only the affected item when a row is structurally invalid", async () => {
    const load = await loadProductionState(
      port({
        eventRows: [
          ...eventRows,
          row("recBad", {
            "Event ID": "EVT-5001",
            "Event type": "Receipt",
            "Occurred at": "2026-08-03T08:00:00.000Z",
            Item: "milk-whole",
            "Record class": "Production",
          }),
        ],
      }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.quarantinedItemKeys).toEqual(["milk-whole"]);
    expect(load.openingEvents.some((e) => e.itemKey === "oats-rolled")).toBe(true);
  });

  it("treats an unavailable connector as a fatal, non-silent failure", async () => {
    const load = await loadProductionState(port({ failWith: "airtable 503" }), scope);
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("SOURCE_UNAVAILABLE");
    expect(load.openingEvents).toEqual([]);
  });

  it("refuses a source claiming production provenance from a fake base", async () => {
    const lying = createAirtableProductionPort({
      mode: "PRODUCTION_READ_ONLY",
      source: createFakeAirtableRowSource({ eventRows }),
    });
    const load = await loadProductionState(lying, { ...scope, mode: "PRODUCTION_READ_ONLY" });
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("PROVENANCE_CONTAMINATION");
  });

  it("is deterministic across repeated reads", async () => {
    const a = await loadProductionState(port(), scope);
    const b = await loadProductionState(port(), scope);
    expect(b.sourceId).toBe(a.sourceId);
  });

  it("satisfies the executable production-port contract", async () => {
    const result = await productionPortContract(port(), scope);
    expect(result.passed).toBe(true);
  });
});
