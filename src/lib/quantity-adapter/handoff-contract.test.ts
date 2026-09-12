import { describe, expect, it } from "vitest";

import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { HouseholdEvent, QuantityRequirementsHandoff } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "./adapter";

const NOW = () => "1970-01-01T00:00:00.000Z";

const handoff = (
  items: QuantityRequirementsHandoff["items"],
  overrides: Partial<QuantityRequirementsHandoff> = {},
): QuantityRequirementsHandoff => ({
  replayId: "replay-1",
  snapshotId: "snapshot-1",
  replayTimestamp: "1970-01-01T00:00:00.000Z",
  reconciliationStatus: "CLEAN",
  canonicalReconciliationStatus: "CLEAN",
  readyForQuantityRun: true,
  items,
  blockedItemKeys: [],
  ...overrides,
});

const target = { itemKey: "salmon", targetQuantity: 1000, unit: "g" };

describe("downstream handoff contract", () => {
  it("never reads qualified/ambiguous on-hand evidence as exact", () => {
    const input = handoff([
      {
        itemKey: "salmon",
        quantity: 780,
        unit: "g",
        evidencePrecision: "QUALIFIED_AMBIGUOUS",
        sourceEventIds: ["EVT-1"],
      },
    ]);

    const isolatedPlan = adaptSnapshotToQuantityRun(input, {
      targets: [target],
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(isolatedPlan.requirements).toEqual([]);
    expect(isolatedPlan.rejections.map((r) => r.code)).toContain("ITEM_ISOLATED");

    const refusedPlan = adaptSnapshotToQuantityRun(input, { targets: [target] });
    expect(refusedPlan.executed).toBe(false);
    expect(refusedPlan.eligibleForProcurement).toBe(false);
    expect(refusedPlan.rejections[0]?.code).toBe("RECONCILIATION_UNCERTAIN");
  });

  it("still plans exact evidence alongside an isolated ambiguous item", () => {
    const plan = adaptSnapshotToQuantityRun(
      handoff([
        {
          itemKey: "salmon",
          quantity: 780,
          unit: "g",
          evidencePrecision: "QUALIFIED_AMBIGUOUS",
          sourceEventIds: ["EVT-1"],
        },
        {
          itemKey: "rice",
          quantity: 200,
          unit: "g",
          evidencePrecision: "EXACT",
          sourceEventIds: ["EVT-2"],
        },
      ]),
      {
        targets: [target, { itemKey: "rice", targetQuantity: 500, unit: "g" }],
        blockedItemPolicy: "ISOLATE_ITEMS",
      },
    );

    expect(plan.requirements.map((r) => r.itemKey)).toEqual(["rice"]);
    expect(plan.rejections.find((r) => r.code === "ITEM_ISOLATED")?.itemKey).toBe("salmon");
  });

  it("fails closed on an unresolved conflict and stays deterministic", () => {
    const events: HouseholdEvent[] = [
      {
        eventId: "EVT-1",
        recordClass: "Production",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: "salmon",
        occurredAt: "2026-09-07T08:00:00.000Z",
        payload: { quantity: 780, unit: "g" },
      },
      {
        eventId: "EVT-1",
        recordClass: "Production",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: "salmon",
        occurredAt: "2026-09-07T08:00:00.000Z",
        payload: { quantity: 200, unit: "g" },
      },
    ];
    const snapshot = replayEvents(events, { now: NOW });
    const first = adaptSnapshotToQuantityRun(snapshot, { targets: [target] });
    const second = adaptSnapshotToQuantityRun(snapshot, { targets: [target] });

    expect(first.executed).toBe(false);
    expect(first.requirements).toEqual([]);
    expect(first.rejections[0]?.code).toBe("RECONCILIATION_BLOCKED");
    expect(first.planId).toBe(second.planId);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("carries explicit snapshot identity and per-line provenance", () => {
    const events: HouseholdEvent[] = [
      {
        eventId: "EVT-9",
        recordClass: "Production",
        eventType: "ITEM_STOCK_SET",
        itemKey: "salmon",
        occurredAt: "2026-09-07T08:00:00.000Z",
        payload: { quantity: 400, unit: "g" },
      },
    ];
    const snapshot = replayEvents(events, { now: NOW });
    const derived = toQuantityRequirementsHandoff(snapshot);
    const plan = adaptSnapshotToQuantityRun(snapshot, { targets: [target] });

    expect(derived.snapshotId).toBe(snapshot.snapshotId);
    expect(derived.replayId).toBe(snapshot.replayId);
    expect(plan.snapshotId).toBe(snapshot.snapshotId);
    expect(plan.replayId).toBe(snapshot.replayId);
    expect(plan.requirements[0]?.sourceEventIds).toEqual(["EVT-9"]);
    expect(plan.requirements[0]?.requiredQuantity).toBe(600);
  });
});
