import { describe, it, expect } from "vitest";
import { replayEvents } from "./engine";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import type { HouseholdEvent } from "./types";
import type { AdapterOptions } from "../quantity-adapter/types";

/**
 * Temporal/provenance regression: wall-clock replay time is provenance, not
 * state. Re-replaying an unchanged event log must not mint a new plan identity
 * (which flows into basketId and approval/dispatch identity).
 */
const events: HouseholdEvent[] = [
  {
    eventId: "CLOCK-E1",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-01T08:00:00.000Z",
    payload: { quantity: 800, unit: "g" },
  },
  {
    eventId: "CLOCK-E2",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-02T08:00:00.000Z",
    payload: { quantity: -200, unit: "g" },
  },
];

const options: AdapterOptions = {
  targets: [{ itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" }],
};

describe("replay clock does not leak into output identity", () => {
  const early = replayEvents(events, { now: () => "2026-09-01T10:00:00.000Z" });
  const late = replayEvents(events, { now: () => "2026-09-07T23:59:59.000Z" });

  it("snapshot identity is clock-independent", () => {
    expect(early.snapshotId).toBe(late.snapshotId);
    expect(early.replayId).toBe(late.replayId);
    expect(early.replayTimestamp).not.toBe(late.replayTimestamp);
  });

  it("plan identity is clock-independent", () => {
    const a = adaptSnapshotToQuantityRun(early, options);
    const b = adaptSnapshotToQuantityRun(late, options);
    expect(a.planId).toBe(b.planId);
  });

  it("plan still carries the replay timestamp as provenance", () => {
    const a = adaptSnapshotToQuantityRun(early, options);
    expect(a.replayTimestamp).toBe("2026-09-01T10:00:00.000Z");
    expect(a.snapshotId).toBe(early.snapshotId);
    expect(a.replayId).toBe(early.replayId);
  });

  it("a real state change still changes plan identity", () => {
    const changed = replayEvents(
      [
        ...events,
        {
          eventId: "CLOCK-E3",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: "oats-rolled",
          occurredAt: "2026-08-03T08:00:00.000Z",
          payload: { quantity: -100, unit: "g" },
        },
      ],
      { now: () => "2026-09-01T10:00:00.000Z" },
    );
    const a = adaptSnapshotToQuantityRun(early, options);
    const c = adaptSnapshotToQuantityRun(changed, options);
    expect(c.planId).not.toBe(a.planId);
  });

  it("refused plans are also clock-independent", () => {
    const a = adaptSnapshotToQuantityRun(early, { ...options, isolatedItemKeys: ["oats-rolled"] });
    const b = adaptSnapshotToQuantityRun(late, { ...options, isolatedItemKeys: ["oats-rolled"] });
    expect(a.eligibleForProcurement).toBe(false);
    expect(a.planId).toBe(b.planId);
  });
});
