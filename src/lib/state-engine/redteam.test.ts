import { describe, expect, it } from "vitest";

import { replayEvents, toQuantityRequirementsHandoff } from "./engine";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import { projectConsumptionEvents } from "../consumption/projector";
import type { HouseholdEvent } from "./types";

const fixedNow = { now: () => "1970-01-01T00:00:00.000Z" };

/** Synthetic stand-in for the stale salmon line — never real household data. */
const salmonOpening: HouseholdEvent = {
  eventId: "RT-OPEN-SALMON",
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "salmon-fillets",
  occurredAt: "2026-08-11T09:00:00.000Z",
  payload: { quantity: 780, unit: "g", note: "synthetic opening balance" },
};

const oatsOpening: HouseholdEvent = {
  eventId: "RT-OPEN-OATS",
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "oats-rolled",
  occurredAt: "2026-08-11T09:00:00.000Z",
  payload: { quantity: 400, unit: "g" },
};

describe("red-team: unit-incomparable deltas", () => {
  it("refuses to mix units on a delta and blocks the item instead of corrupting on-hand", () => {
    const snapshot = replayEvents(
      [
        salmonOpening,
        {
          eventId: "RT-BURN-KG",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: "salmon-fillets",
          occurredAt: "2026-08-11T19:00:00.000Z",
          payload: { quantity: -1, unit: "kg" },
        },
      ],
      fixedNow,
    );
    const salmon = snapshot.items.find((i) => i.itemKey === "salmon-fillets");
    expect(salmon?.quantity).toBe(780);
    expect(salmon?.unit).toBe("g");
    expect(salmon?.blocked).toBe(true);
    expect(snapshot.reconciliationStatus).toBe("BLOCKED");
    expect(snapshot.exceptions.map((e) => e.code)).toContain("UNIT_CONFLICT_BLOCKED");
    expect(snapshot.ignoredEventIds).toContain("RT-BURN-KG");
    expect(snapshot.contributingEventIds).not.toContain("RT-BURN-KG");
  });

  it("still applies same-unit and unit-less deltas", () => {
    const snapshot = replayEvents(
      [
        salmonOpening,
        {
          eventId: "RT-BURN-G",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: "salmon-fillets",
          occurredAt: "2026-08-11T19:00:00.000Z",
          payload: { quantity: -390, unit: "g" },
        },
        {
          eventId: "RT-BURN-NOUNIT",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: "salmon-fillets",
          occurredAt: "2026-08-11T19:30:00.000Z",
          payload: { quantity: -90 },
        },
      ],
      fixedNow,
    );
    expect(snapshot.items[0]?.quantity).toBe(300);
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
  });
});

describe("red-team: stale inventory / over-consumption", () => {
  const overBurn = [
    salmonOpening,
    oatsOpening,
    {
      eventId: "RT-BURN-1",
      recordClass: "Production" as const,
      eventType: "ITEM_STOCK_DELTA" as const,
      itemKey: "salmon-fillets",
      occurredAt: "2026-08-11T19:00:00.000Z",
      payload: { quantity: -780, unit: "g" },
    },
    {
      eventId: "RT-BURN-2",
      recordClass: "Production" as const,
      eventType: "ITEM_STOCK_DELTA" as const,
      itemKey: "salmon-fillets",
      occurredAt: "2026-08-12T19:00:00.000Z",
      payload: { quantity: -390, unit: "g" },
    },
  ];

  it("isolates an item driven negative without blocking the whole replay", () => {
    const snapshot = replayEvents(overBurn, fixedNow);
    expect(snapshot.reconciliationStatus).toBe("EXCEPTIONS");
    expect(snapshot.blockedItemKeys).toEqual(["salmon-fillets"]);
    expect(snapshot.exceptions.map((e) => e.code)).toContain("NEGATIVE_STOCK_ISOLATED");
    // Provenance is preserved for the isolated item.
    const salmon = snapshot.items.find((i) => i.itemKey === "salmon-fillets");
    expect(salmon?.contributingEventIds).toEqual(["RT-OPEN-SALMON", "RT-BURN-1", "RT-BURN-2"]);
    expect(salmon?.quantity).toBe(-390);
  });

  it("withholds only the isolated item and keeps unrelated planning alive", () => {
    const snapshot = replayEvents(overBurn, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [
        { itemKey: "salmon-fillets", targetQuantity: 780, unit: "g" },
        { itemKey: "oats-rolled", targetQuantity: 1000, unit: "g" },
      ],
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(plan.executed).toBe(true);
    expect(plan.requirements.map((r) => r.itemKey)).toEqual(["oats-rolled"]);
    expect(plan.requirements[0]?.requiredQuantity).toBe(600);
    expect(plan.rejections.find((r) => r.itemKey === "salmon-fillets")?.code).toBe(
      "ITEM_ISOLATED",
    );
    expect(plan.snapshotId).toBe(snapshot.snapshotId);
  });

  it("default policy still refuses the run when any item is isolated", () => {
    const snapshot = replayEvents(overBurn, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "oats-rolled", targetQuantity: 1000, unit: "g" }],
    });
    expect(plan.executed).toBe(false);
    expect(plan.rejections[0]?.code).toBe("RECONCILIATION_UNCERTAIN");
  });

  it("never falls back to static inventory for a blocked item", () => {
    const snapshot = replayEvents(
      [
        salmonOpening,
        { ...salmonOpening, payload: { quantity: 1560, unit: "g" } },
      ],
      fixedNow,
    );
    expect(snapshot.reconciliationStatus).toBe("BLOCKED");
    const handoff = toQuantityRequirementsHandoff(snapshot);
    expect(handoff.items.map((i) => i.itemKey)).not.toContain("salmon-fillets");
    const isolatedPlan = adaptSnapshotToQuantityRun(handoff, {
      targets: [{ itemKey: "salmon-fillets", targetQuantity: 780, unit: "g" }],
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(isolatedPlan.requirements).toHaveLength(0);
    expect(isolatedPlan.eligibleForProcurement).toBe(false);
  });
});

describe("red-team: planned consumption supersedes the static picture", () => {
  it("an eaten planned meal makes replayed state authoritative and deterministic", () => {
    const project = () =>
      projectConsumptionEvents(
        {
          openingEvents: [salmonOpening],
          meals: [
            {
              mealId: "MEAL-SALMON-TUE",
              plannedFor: "2026-08-11T19:00:00.000Z",
              state: "COMPLETED",
              components: [{ itemKey: "salmon-fillets", quantity: 780, unit: "g" }],
            },
          ],
        },
        { asOf: "2026-08-12T08:00:00.000Z" },
      );
    const first = replayEvents(project().events, fixedNow);
    // Re-delivery of the same completion must not double-decrement.
    const replayed = replayEvents([...project().events, ...project().events], fixedNow);
    expect(first.items[0]?.quantity).toBe(0);
    expect(replayed.items[0]?.quantity).toBe(0);
    expect(replayed.exceptions.some((e) => e.code === "DUPLICATE_EVENT_IGNORED")).toBe(true);
    expect(replayed.reconciliationStatus).toBe("EXCEPTIONS");
    expect(replayEvents(project().events, fixedNow).snapshotId).toBe(first.snapshotId);
  });
});
