import { describe, it, expect } from "vitest";
import { replayEvents } from "./engine";
import type { HouseholdEvent } from "./types";

const NOW = () => "2026-09-12T00:00:00.000Z";

const delta = (
  eventId: string,
  quantity: number,
  overrides: Partial<HouseholdEvent> = {},
): HouseholdEvent => ({
  eventId,
  recordClass: "Production",
  eventType: "ITEM_STOCK_DELTA",
  itemKey: "salmon",
  occurredAt: "2026-09-07T08:00:00.000Z",
  payload: { quantity, unit: "g" },
  ...overrides,
});

describe("conflict semantics", () => {
  it("treats a semantically equivalent payload as an identical duplicate", () => {
    const a = delta("EVT-1", 780);
    const b: HouseholdEvent = {
      ...delta("EVT-1", 780),
      // Same canonical content, different key order.
      payload: { unit: "g", quantity: 780 },
    };
    const snap = replayEvents([a, b], { now: NOW });

    expect(snap.exceptions.map((x) => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
    expect(snap.items[0]?.quantity).toBe(780);
    expect(snap.items[0]?.blocked).toBe(false);
    expect(snap.snapshotId).toBe(replayEvents([a], { now: NOW }).snapshotId);
  });

  it("blocks a materially different reused Event ID without partially mutating state", () => {
    const snap = replayEvents([delta("EVT-1", 780), delta("EVT-1", 200)], { now: NOW });

    expect(snap.items[0]?.quantity).toBe(780); // no second mutation
    expect(snap.blockedItemKeys).toEqual(["salmon"]);
    expect(snap.canonicalReconciliationStatus).toBe("BLOCKED");
    expect(
      snap.exceptions.filter((x) => x.code === "REUSED_EVENT_ID_PAYLOAD_CONFLICT"),
    ).toHaveLength(1);
  });

  it("isolates a reused-ID conflict to the items involved", () => {
    const snap = replayEvents(
      [
        delta("EVT-1", 780),
        delta("EVT-1", 200, { itemKey: "butter" }),
        delta("EVT-2", 500, { itemKey: "rice" }),
      ],
      { now: NOW },
    );

    expect(snap.blockedItemKeys).toEqual(["butter", "salmon"]);
    expect(snap.items.find((i) => i.itemKey === "rice")?.blocked).toBe(false);
    expect(snap.items.find((i) => i.itemKey === "rice")?.quantity).toBe(500);
  });

  it("re-delivering an already-reported conflicting event does not change identity", () => {
    const once = replayEvents([delta("EVT-1", 780), delta("EVT-1", 200)], { now: NOW });
    const twice = replayEvents(
      [delta("EVT-1", 780), delta("EVT-1", 200), delta("EVT-1", 200)],
      { now: NOW },
    );

    expect(twice.items).toEqual(once.items);
    expect(twice.replayId).toBe(once.replayId);
    expect(twice.snapshotId).toBe(once.snapshotId);
    expect(twice.canonicalReconciliationStatus).toBe("BLOCKED");
    expect(
      twice.exceptions.filter((x) => x.code === "REUSED_EVENT_ID_PAYLOAD_CONFLICT"),
    ).toHaveLength(1);
    // The re-delivery is still audited, just non-canonically.
    expect(
      twice.exceptions.filter((x) => x.code === "DUPLICATE_EVENT_IGNORED"),
    ).toHaveLength(1);
  });

  it("repeated identical delivery of a whole delivery batch stays idempotent", () => {
    const batch = [
      delta("EVT-1", 780),
      delta("EVT-2", 250, { itemKey: "butter" }),
    ];
    const once = replayEvents(batch, { now: NOW });
    const thrice = replayEvents([...batch, ...batch, ...batch], { now: NOW });

    expect(thrice.items).toEqual(once.items);
    expect(thrice.snapshotId).toBe(once.snapshotId);
    expect(thrice.blockedItemKeys).toEqual([]);
    expect(thrice.canonicalReconciliationStatus).toBe("CLEAN");
  });

  it("keeps first-occurrence-wins deterministic regardless of which payload arrives first", () => {
    const forward = replayEvents([delta("EVT-1", 780), delta("EVT-1", 200)], { now: NOW });
    const reverse = replayEvents([delta("EVT-1", 200), delta("EVT-1", 780)], { now: NOW });

    expect(forward.items[0]?.quantity).toBe(780);
    expect(reverse.items[0]?.quantity).toBe(200);
    // Both orderings block the item; neither leaves a merged/partial quantity.
    expect(forward.blockedItemKeys).toEqual(["salmon"]);
    expect(reverse.blockedItemKeys).toEqual(["salmon"]);
    expect(replayEvents([delta("EVT-1", 780), delta("EVT-1", 200)], { now: NOW }).snapshotId).toBe(
      forward.snapshotId,
    );
  });

  it("excludes a blocked conflicted item from the downstream handoff", () => {
    const snap = replayEvents(
      [delta("EVT-1", 780), delta("EVT-1", 200), delta("EVT-2", 500, { itemKey: "rice" })],
      { now: NOW },
    );

    expect(snap.items.find((i) => i.itemKey === "salmon")?.blocked).toBe(true);
    expect(snap.items.find((i) => i.itemKey === "rice")?.blocked).toBe(false);
  });
});
