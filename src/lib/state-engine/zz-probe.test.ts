import { describe, it, expect } from "vitest";
import { replayEvents } from "./engine";
import type { HouseholdEvent } from "./types";

const ev = (id: string, q: number, extra: Partial<HouseholdEvent> = {}): HouseholdEvent => ({
  eventId: id, recordClass: "Production", eventType: "ITEM_STOCK_DELTA",
  itemKey: "salmon", occurredAt: "2026-08-01T08:00:00.000Z",
  payload: { quantity: q, unit: "g" }, ...extra,
});

describe("probe", () => {
  it("key order / undefined equivalence", () => {
    const a = replayEvents([{ ...ev("X", 100), payload: { quantity: 100, unit: "g" } }, { ...ev("X", 100), payload: { unit: "g", quantity: 100, evidencePrecision: undefined } }], { now: () => "T" });
    expect(a.exceptions.map(x => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
  });
  it("re-delivered conflicting event does not change identity", () => {
    const once = replayEvents([ev("X", 100), ev("X", 200)], { now: () => "T" });
    const twice = replayEvents([ev("X", 100), ev("X", 200), ev("X", 200)], { now: () => "T" });
    console.log("once", once.snapshotId, once.replayId, once.exceptions.map(x=>x.code));
    console.log("twice", twice.snapshotId, twice.replayId, twice.exceptions.map(x=>x.code));
    expect(twice.items).toEqual(once.items);
    expect(twice.snapshotId).toBe(once.snapshotId);
  });
});
