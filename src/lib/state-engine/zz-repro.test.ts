import { describe, it, expect } from "vitest";
import { replayEvents } from "@/lib/state-engine/engine";
import { adaptSnapshotToQuantityRun } from "@/lib/quantity-adapter/adapter";
import type { HouseholdEvent } from "@/lib/state-engine/types";

const events: HouseholdEvent[] = [
  { eventId: "E1", recordClass: "Production", eventType: "ITEM_STOCK_SET", itemKey: "oats-rolled", occurredAt: "2026-08-01T08:00:00.000Z", payload: { quantity: 800, unit: "g" } },
];

describe("clock", () => {
  it("same events, different wall clock", () => {
    const a = replayEvents(events, { now: () => "2026-09-01T10:00:00.000Z" });
    const b = replayEvents(events, { now: () => "2026-09-01T11:00:00.000Z" });
    expect(a.snapshotId).toBe(b.snapshotId);
    const opts = { targets: [{ itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" }] } as any;
    const pa = adaptSnapshotToQuantityRun(a, opts);
    const pb = adaptSnapshotToQuantityRun(b, opts);
    console.log("planA", pa.planId, "planB", pb.planId, pa.rejections);
    expect(pa.planId).toBe(pb.planId);
  });
});
