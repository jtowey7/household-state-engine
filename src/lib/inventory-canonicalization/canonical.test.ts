import { describe, expect, it } from "vitest";
import { canonicaliseInventory, classifyUnit, inventoryIdentityKey } from "./canonical";
import type { InventoryRecord } from "./types";

const record = (overrides: Partial<InventoryRecord> = {}): InventoryRecord => ({
  recordId: "rec-1",
  item: "Milk",
  quantity: 1,
  unit: "l",
  variant: null,
  location: "Fridge",
  bestBefore: "2026-08-16",
  source: "Tesco",
  delivered: "2026-08-13",
  notes: null,
  ...overrides,
});

describe("inventory canonicalisation", () => {
  it("classifies supported unit families", () => {
    expect(classifyUnit("kg")).toBe("MASS");
    expect(classifyUnit("g")).toBe("MASS");
    expect(classifyUnit("litres")).toBe("VOLUME");
    expect(classifyUnit("ml")).toBe("VOLUME");
    expect(classifyUnit("each")).toBe("COUNT");
    expect(classifyUnit("tin")).toBe("OTHER");
  });

  it("normalises item identity without collapsing explicit variants", () => {
    expect(inventoryIdentityKey({ item: "  Semi-Skimmed  Milk ", variant: null })).toBe("semi-skimmed milk");
    expect(inventoryIdentityKey({ item: "Milk", variant: "Organic" })).toBe("milk::organic");
    expect(inventoryIdentityKey({ item: "Milk", variant: "organic" })).toBe("milk::organic");
  });

  it("aggregates compatible mass units and preserves source batches", () => {
    const result = canonicaliseInventory([
      record({ recordId: "rec-b", quantity: 1.5, unit: "kg", bestBefore: "2026-08-18" }),
      record({ recordId: "rec-a", quantity: 500, unit: "g", location: "Cupboard" }),
    ]);

    expect(result.unmergeableRecordIds).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      item: "Milk",
      unitFamily: "MASS",
      canonicalUnit: "g",
      totalQuantity: 2000,
      sourceRecordIds: ["rec-a", "rec-b"],
    });
    expect(result.items[0].batches.map((batch) => batch.recordId)).toEqual(["rec-a", "rec-b"]);
    expect(result.items[0].batches[0].location).toBe("Cupboard");
    expect(result.items[0].batches[1].bestBefore).toBe("2026-08-18");
  });

  it("aggregates compatible volume units", () => {
    const result = canonicaliseInventory([
      record({ recordId: "rec-1", quantity: 1, unit: "l" }),
      record({ recordId: "rec-2", quantity: 500, unit: "ml" }),
    ]);

    expect(result.items[0].canonicalUnit).toBe("ml");
    expect(result.items[0].totalQuantity).toBe(1500);
  });

  it("aggregates equivalent count units but does not invent pack conversions", () => {
    const result = canonicaliseInventory([
      record({ recordId: "rec-1", quantity: 2, unit: "each" }),
      record({ recordId: "rec-2", quantity: 3, unit: "items" }),
      record({ recordId: "rec-3", quantity: 2, unit: "pack" }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].totalQuantity).toBe(5);
    expect(result.items[0].sourceRecordIds).toEqual(["rec-1", "rec-2"]);
    expect(result.unmergeableRecordIds).toEqual(["rec-3"]);
  });

  it("keeps explicit variants separate", () => {
    const result = canonicaliseInventory([
      record({ recordId: "rec-a", variant: "organic" }),
      record({ recordId: "rec-b", variant: "standard" }),
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.variant)).toEqual(["organic", "standard"]);
  });

  it("does not merge unknown units and never guesses conversions", () => {
    const result = canonicaliseInventory([
      record({ recordId: "rec-known", quantity: 2, unit: "kg" }),
      record({ recordId: "rec-unknown", quantity: 1, unit: "scoop" }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceRecordIds).toEqual(["rec-known"]);
    expect(result.unmergeableRecordIds).toEqual(["rec-unknown"]);
  });

  it("is deterministic regardless of input order", () => {
    const first = canonicaliseInventory([
      record({ recordId: "rec-b", quantity: 1, unit: "kg" }),
      record({ recordId: "rec-a", quantity: 500, unit: "g" }),
    ]);
    const second = canonicaliseInventory([
      record({ recordId: "rec-a", quantity: 500, unit: "g" }),
      record({ recordId: "rec-b", quantity: 1, unit: "kg" }),
    ]);

    expect(second).toEqual(first);
  });
});
