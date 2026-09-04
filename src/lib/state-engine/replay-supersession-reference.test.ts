import { describe, expect, it } from "vitest";
import { replayEvents, type HouseholdEvent } from "./index";

const now = () => "2026-01-01T00:00:00.000Z";

const event = (overrides: Partial<HouseholdEvent> & { eventId: string }): HouseholdEvent => ({
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "milk",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { quantity: 2, unit: "l" },
  ...overrides,
});

describe("supersession target referential integrity", () => {
  it("blocks an event that supersedes an absent Event ID", () => {
    const result = replayEvents(
      [event({ eventId: "E2", supersedes: ["MISSING-E1"] })],
      { now },
    );

    expect(result.reconciliationStatus).toBe("BLOCKED");
    expect(result.contributingEventIds).toEqual([]);
    expect(result.blockedItemKeys).toEqual(["milk"]);
    expect(result.items.find((i) => i.itemKey === "milk")?.blocked).toBe(true);
    expect(result.exceptions.map((x) => x.code)).toEqual(["SUPERSESSION_TARGET_MISSING"]);
    expect(result.exceptions[0]?.detail).toContain("MISSING-E1");
  });

  it("preserves deterministic behaviour when a valid and dangling supersession coexist", () => {
    const events = [
      event({ eventId: "E1", payload: { quantity: 1, unit: "l" } }),
      event({ eventId: "E2", supersedes: ["E1"], payload: { quantity: 3, unit: "l" } }),
      event({ eventId: "E3", itemKey: "eggs", supersedes: ["MISSING-E3"], payload: { quantity: 4, unit: "each" } }),
      event({ eventId: "B1", itemKey: "butter", payload: { quantity: 200, unit: "g" } }),
    ];

    const first = replayEvents(events, { now });
    const second = replayEvents(events, { now });

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.replayId).toBe(second.replayId);
    expect(first.reconciliationStatus).toBe("BLOCKED");
    expect(first.items.find((i) => i.itemKey === "milk")?.quantity).toBe(3);
    expect(first.items.find((i) => i.itemKey === "milk")?.blocked).toBe(false);
    expect(first.items.find((i) => i.itemKey === "butter")?.quantity).toBe(200);
    expect(first.items.find((i) => i.itemKey === "butter")?.blocked).toBe(false);
    expect(first.items.find((i) => i.itemKey === "eggs")?.blocked).toBe(true);
    expect(first.blockedItemKeys).toEqual(["eggs"]);
    expect(first.exceptions.map((x) => x.code)).toEqual([
      "SUPERSEDED_EVENT_NOT_APPLIED",
      "SUPERSESSION_TARGET_MISSING",
    ]);
  });
});
