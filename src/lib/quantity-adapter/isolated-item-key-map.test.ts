import { describe, expect, it } from "vitest";

import { adaptSnapshotToQuantityRun } from "./adapter";
import type { ItemKeyMapEntry } from "./item-key-map";

describe("isolated item key mapping", () => {
  it("keeps an explicitly isolated ambiguous alias isolated", () => {
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
        { itemKey: "frozen chips", quantity: 0, unit: "kg", sourceEventIds: [], evidencePrecision: "EXACT" as const },
      ],
      blockedItemKeys: [],
    };

    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: [{ itemKey: "frozen chips", targetQuantity: 1.5, unit: "kg" }],
      itemKeyMap: ambiguousMap,
      blockedItemPolicy: "ISOLATE_ITEMS",
      isolatedItemKeys: ["frozen chips"],
    });

    expect(plan.executed).toBe(true);
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections).toContainEqual(
      expect.objectContaining({ code: "ITEM_ISOLATED", itemKey: "frozen chips" }),
    );
  });
});
