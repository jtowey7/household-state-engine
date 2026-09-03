import { describe, expect, it } from "vitest";

import { replayEvents } from "../state-engine/engine";
import { baseFixture } from "../state-engine/fixtures";
import { adaptSnapshotToQuantityRun } from "./adapter";
import {
  resolveDemandTargets,
  resolveItemKey,
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

  it("preserves already-canonical replay rows before quantity subtraction", () => {
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
    expect(result.changed).toBe(false);
    expect(result.value).toEqual(handoff);
  });

  it("never redirects a canonical replay item through a coincident recipe alias", () => {
    const coincidentAliasMap: ItemKeyMapEntry[] = [
      {
        alias: "canonical-stock-key",
        canonicalItemKey: "different-stock-key",
        sourceUnit: "each",
        canonicalUnit: "each",
        conversionFactor: 1,
      },
    ];
    const handoff = {
      replayId: "r",
      snapshotId: "s",
      replayTimestamp: "1970-01-01T00:00:00.000Z",
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "canonical-stock-key", quantity: 3, unit: "each", sourceEventIds: ["E1"] },
      ],
      blockedItemKeys: [],
    };

    const result = resolveQuantityHandoff(handoff, coincidentAliasMap);

    expect(result).toEqual({
      changed: false,
      value: handoff,
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

  it("fails closed when an active alias maps to conflicting canonical identities", () => {
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

    expect(resolveItemKey("frozen chips", "kg", ambiguousMap)).toEqual({
      itemKey: "frozen chips",
      unit: "kg",
      conversionFactor: 1,
      mapped: false,
    });
    expect(
      resolveDemandTargets(
        [{ itemKey: "frozen chips", targetQuantity: 1.5, unit: "kg" }],
        ambiguousMap,
      ),
    ).toEqual({
      changed: false,
      value: [{ itemKey: "frozen chips", targetQuantity: 1.5, unit: "kg" }],
      blockedItemKeys: ["frozen chips"],
    });
  });

  it("allows identical duplicate aliases but never lets a later conflicting row override the ambiguity", () => {
    const duplicateMap: ItemKeyMapEntry[] = [
      {
        alias: "onions",
        canonicalItemKey: "brown-onions",
        sourceUnit: "item",
        canonicalUnit: "g",
        conversionFactor: 120,
      },
      {
        alias: "onions",
        canonicalItemKey: "brown-onions",
        sourceUnit: "item",
        canonicalUnit: "g",
        conversionFactor: 120,
      },
      {
        alias: "onions",
        canonicalItemKey: "red-onions",
        sourceUnit: "item",
        canonicalUnit: "g",
        conversionFactor: 100,
      },
    ];

    expect(resolveItemKey("onions", "item", duplicateMap)).toEqual({
      itemKey: "onions",
      unit: "item",
      conversionFactor: 1,
      mapped: false,
    });
  });

  it("does not canonicalise blocked item keys through an ambiguous alias", () => {
    const ambiguousMap: ItemKeyMapEntry[] = [
      {
        alias: "peppers",
        canonicalItemKey: "red-pepper",
        sourceUnit: "item",
        canonicalUnit: "each",
        conversionFactor: 1,
      },
      {
        alias: "peppers",
        canonicalItemKey: "mixed-peppers",
        sourceUnit: "item",
        canonicalUnit: "each",
        conversionFactor: 1,
      },
    ];

    const handoff = {
      replayId: "r",
      snapshotId: "s",
      replayTimestamp: "1970-01-01T00:00:00.000Z",
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [],
      blockedItemKeys: ["peppers"],
    };

    expect(resolveQuantityHandoff(handoff, ambiguousMap)).toEqual({
      changed: false,
      value: handoff,
    });
  });

  it("never redirects an already-canonical blocked key through a coincident recipe alias", () => {
    const coincidentAliasMap: ItemKeyMapEntry[] = [
      {
        alias: "canonical-blocked-key",
        canonicalItemKey: "other-product-key",
        sourceUnit: "each",
        canonicalUnit: "each",
        conversionFactor: 1,
      },
    ];
    const handoff = {
      replayId: "r",
      snapshotId: "s",
      replayTimestamp: "1970-01-01T00:00:00.000Z",
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [],
      blockedItemKeys: ["canonical-blocked-key"],
    };

    const result = resolveQuantityHandoff(handoff, coincidentAliasMap);

    expect(result).toEqual({
      changed: false,
      value: handoff,
    });
  });
});
