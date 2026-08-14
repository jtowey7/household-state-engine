import { describe, expect, it } from "vitest";
import { buildInventoryBaseline } from "./inventory-baseline";
import { replayEvents } from "./engine";

const BASELINE = "2026-08-12T12:12:00.000Z";

describe("inventory baseline boundary", () => {
  it("turns an eligible current inventory snapshot into production stock-set events", () => {
    const baseline = buildInventoryBaseline(
      [
        { recordId: "rec-oats", item: "Oats", quantity: 2, unit: "kg", status: "In stock" },
        { recordId: "rec-milk", item: "Milk", quantity: 3, unit: "l", status: "Low" },
      ],
      BASELINE,
    );

    expect(baseline.source).toBe("INVENTORY_SNAPSHOT");
    expect(baseline.exceptions).toEqual([]);
    expect(baseline.events).toHaveLength(2);
    expect(baseline.events[0]).toMatchObject({
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      occurredAt: BASELINE,
      itemKey: "Milk",
    });
    expect(baseline.events[0]?.payload.note).toContain("sourceRecordIds=rec-milk");

    const snapshot = replayEvents(baseline.events, { now: () => BASELINE });
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
    expect(snapshot.items).toEqual([
      expect.objectContaining({ itemKey: "Milk", quantity: 3, unit: "l" }),
      expect.objectContaining({ itemKey: "Oats", quantity: 2, unit: "kg" }),
    ]);
  });

  it("does not fabricate history: every baseline event occurs at the snapshot timestamp", () => {
    const baseline = buildInventoryBaseline(
      [{ recordId: "rec-1", item: "Rice", quantity: 1, unit: "kg" }],
      BASELINE,
    );
    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]?.occurredAt).toBe(BASELINE);
    expect(baseline.events[0]?.eventId).toContain(`BASELINE:${BASELINE}:`);
  });

  it("quarantines Out, blank and invalid rows instead of inventing stock", () => {
    const baseline = buildInventoryBaseline(
      [
        { recordId: "rec-out", item: "Beans", quantity: 4, unit: "tin", status: "Out" },
        { recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" },
        { recordId: "rec-negative", item: "Rice", quantity: -1, unit: "kg" },
        { recordId: "rec-no-item", item: "", quantity: 1, unit: "kg" },
      ],
      BASELINE,
    );

    expect(baseline.events).toEqual([]);
    expect(baseline.exceptions.map((x) => x.code)).toEqual([
      "MISSING_ITEM",
      "MISSING_QUANTITY",
      "INVALID_QUANTITY",
      "OUT_OF_STOCK",
    ]);
  });

  it("aggregates duplicate item/unit rows and preserves every source record", () => {
    const baseline = buildInventoryBaseline(
      [
        { recordId: "rec-a", item: "Bucatini", quantity: 500, unit: "g" },
        { recordId: "rec-b", item: "Bucatini", quantity: 80, unit: "g" },
        { recordId: "rec-c", item: "Bucatini", quantity: 20, unit: "g" },
      ],
      BASELINE,
    );

    expect(baseline.exceptions).toEqual([]);
    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]).toMatchObject({
      itemKey: "Bucatini",
      payload: { quantity: 600, unit: "g" },
    });
    expect(baseline.events[0]?.payload.note).toContain("sourceRecordIds=rec-a,rec-b,rec-c");

    const snapshot = replayEvents(baseline.events, { now: () => BASELINE });
    expect(snapshot.items).toEqual([
      expect.objectContaining({ itemKey: "Bucatini", quantity: 600, unit: "g" }),
    ]);
  });

  it("quarantines a repeated source record ID so pagination/retry duplication cannot inflate stock", () => {
    const baseline = buildInventoryBaseline(
      [
        { recordId: "rec-duplicate", item: "Pasta", quantity: 2, unit: "pack" },
        { recordId: "rec-duplicate", item: "Pasta", quantity: 2, unit: "pack" },
      ],
      BASELINE,
    );

    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]?.payload).toMatchObject({ quantity: 2, unit: "pack" });
    expect(baseline.exceptions).toEqual([
      expect.objectContaining({
        recordId: "rec-duplicate",
        code: "DUPLICATE_SOURCE_RECORD",
      }),
    ]);
  });

  it("does not infer cross-unit conversion", () => {
    const baseline = buildInventoryBaseline(
      [
        { recordId: "rec-g", item: "Milk", quantity: 500, unit: "ml" },
        { recordId: "rec-l", item: "Milk", quantity: 1, unit: "L" },
      ],
      BASELINE,
    );

    expect(baseline.exceptions).toEqual([]);
    expect(baseline.events).toHaveLength(2);
    expect(baseline.events.map((event) => event.payload)).toEqual([
      expect.objectContaining({ quantity: 1, unit: "L" }),
      expect.objectContaining({ quantity: 500, unit: "ml" }),
    ]);
  });

  it("is deterministic for the same fixed snapshot", () => {
    const rows = [
      { recordId: "rec-a", item: "Apples", quantity: 6, unit: "each" },
      { recordId: "rec-b", item: "Bread", quantity: 1, unit: "loaf" },
    ];
    const a = buildInventoryBaseline(rows, BASELINE);
    const b = buildInventoryBaseline(rows, BASELINE);
    expect(a).toEqual(b);
    expect(a.baselineId).toBe(b.baselineId);
  });

  it("produces the same baseline manifest regardless of inventory pagination/order", () => {
    const firstPageOrder = [
      { recordId: "rec-b", item: "Bread", quantity: 1, unit: "loaf" },
      { recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" },
      { recordId: "rec-a", item: "Apples", quantity: 6, unit: "each" },
    ];
    const retryOrDifferentPageOrder = [
      { recordId: "rec-a", item: "Apples", quantity: 6, unit: "each" },
      { recordId: "rec-blank", item: "Pasta", quantity: null, unit: "pack" },
      { recordId: "rec-b", item: "Bread", quantity: 1, unit: "loaf" },
    ];

    const a = buildInventoryBaseline(firstPageOrder, BASELINE);
    const b = buildInventoryBaseline(retryOrDifferentPageOrder, BASELINE);

    expect(b).toEqual(a);
    expect(b.baselineId).toBe(a.baselineId);
  });
});
