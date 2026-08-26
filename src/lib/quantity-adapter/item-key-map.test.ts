import { describe, expect, it } from "vitest";

import { replayEvents } from "../state-engine/engine";
import { baseFixture } from "../state-engine/fixtures";
import { adaptSnapshotToQuantityRun } from "./adapter";
import {
  resolveDemandTargets,
  resolveQuantityHandoff,
  type ItemKeyMapEntry,
} from "./item-key-map";

const fixedNow = { now: () => "1970-01-01T00:00:00.000Z" };

const map: ItemKeyMapEntry[] = [
  {
    alias: "onions",
    canonicalItemKey: "brown-onions",
    sourceUnit: "item",
    canonicalUnit: "g",
    conversionFactor: 120,
  },
  {
    alias: "brown-onions",
    canonicalItemKey: "brown-onions",
    sourceUnit: "g",
    canonicalUnit: "g",
    conversionFactor: 1,
  },
  {
    alias: "tomato-puree",
    canonicalItemKey: "tomato-puree-200g",
    sourceUnit: "tube",
    canonicalUnit: "g",
    conversionFactor: 200,
  },
];

describe("evidence-backed item key mapping", () => {
  it("converts a recipe target into the canonical household key and unit", () => {
    const result = resolveDemandTargets(
      [{ itemKey: "onions", targetQuantity: 8, unit: "item", packSize: 1, packUnit: "item" }],
      map,
    );
    expect(result.changed).toBe(true);
    expect(result.value).toEqual([
      {
        itemKey: "brown-onions",
        targetQuantity: 960,
        unit: "g",
        packSize: 120,
        packUnit: "g",
      },
    ]);
  });

  it("canonicalises replay rows before quantity subtraction", () => {
    const handoff = {
      replayId: "r",
      snapshotId: "s",
      replayTimestamp: "1970-01-01T00:00:00.000Z",
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "brown-onions", quantity: 600, unit: "g", sourceEventIds: ["E1"] },
      ],
      blockedItemKeys: [],
    };
    const result = resolveQuantityHandoff(handoff, map);
    expect(result.changed).toBe(true);
    expect(result.value.items[0]).toMatchObject({
      itemKey: "brown-onions",
      quantity: 600,
      unit: "g",
    });
  });

  it("lets the quantity adapter reconcile an alias target with canonical replay stock", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "onions", targetQuantity: 8, unit: "item" }],
      itemKeyMap: map,
    });

    expect(plan.executed).toBe(true);
    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]).toMatchObject({
      itemKey: "brown-onions",
      targetQuantity: 960,
      unit: "g",
    });
  });

  it("does not infer a conversion when the source unit is not evidenced", () => {
    const result = resolveDemandTargets(
      [{ itemKey: "onions", targetQuantity: 8, unit: "count" }],
      map,
    );
    expect(result.changed).toBe(false);
    expect(result.value[0]).toEqual({ itemKey: "onions", targetQuantity: 8, unit: "count" });
  });
});
