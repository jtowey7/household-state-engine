import { describe, expect, it } from "vitest";
import { adaptSnapshotToQuantityRun } from "./adapter";
import type { ItemKeyMapEntry } from "./item-key-map";

describe("ambiguous demand item identity", () => {
  const ambiguousMap: ItemKeyMapEntry[] = [
    {
      alias: "frozen chips",
      canonicalItemKey: "super-crispy-fries",
      sourceUnit: "kg",
      canonicalUnit: "g",
      conversionFactor: 1000,
    },
    {
      alias: "frozen chips",
      canonicalItemKey: "tesco-frozen-chips",
      sourceUnit: "kg",
      canonicalUnit: "g",
      conversionFactor: 1000,
    },
  ];

  const handoff = {
    replayId: "r",
    snapshotId: "s",
    replayTimestamp: "1970-01-01T00:00:00.000Z",
    reconciliationStatus: "CLEAN" as const,
    readyForQuantityRun: true,
    items: [
      { itemKey: "frozen chips", quantity: 0.5, unit: "kg", sourceEventIds: ["E1"] },
    ],
    blockedItemKeys: [],
  };

  it("refuses an ambiguous demand alias before quantity/procurement", () => {
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: [{ itemKey: "frozen chips", targetQuantity: 2, unit: "kg" }],
      itemKeyMap: ambiguousMap,
    });

    expect(plan.executed).toBe(false);
    expect(plan.eligibleForProcurement).toBe(false);
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections).toMatchObject([
      { code: "AMBIGUOUS_ITEM_KEY_MAPPING", itemKey: "frozen chips", fatal: true },
    ]);
  });

  it("preserves explicit isolation while allowing unrelated targets to plan", () => {
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: [
        { itemKey: "frozen chips", targetQuantity: 2, unit: "kg" },
        { itemKey: "oats", targetQuantity: 2, unit: "kg" },
      ],
      itemKeyMap: ambiguousMap,
      isolatedItemKeys: ["frozen chips"],
      blockedItemPolicy: "ISOLATE_ITEMS",
    });

    expect(plan.executed).toBe(true);
    expect(plan.requirements.map((r) => r.itemKey)).toEqual(["oats"]);
    expect(plan.rejections).toContainEqual(
      expect.objectContaining({ code: "ITEM_ISOLATED", itemKey: "frozen chips" }),
    );
  });
});
