import { describe, expect, it } from "vitest";
import { replayEvents, type HouseholdEvent } from "./index";

const event = (overrides: Partial<HouseholdEvent> & { eventId: string }): HouseholdEvent => ({
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "oats",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { quantity: 1, unit: "kg" },
  ...overrides,
});

describe("Test event identity exclusion in supersession", () => {
  it("does not let a Test event with a shared ID suppress Production supersession metadata", () => {
    const result = replayEvents([
      event({
        eventId: "E1",
        itemKey: "oats",
        payload: { quantity: 2, unit: "kg" },
      }),
      event({
        eventId: "SHARED-1",
        recordClass: "Test",
        supersedes: ["E1"],
        payload: { quantity: 999, unit: "kg" },
      }),
      event({
        eventId: "SHARED-1",
        recordClass: "Production",
        supersedes: ["E1"],
        payload: { quantity: 4, unit: "kg" },
      }),
    ], { now: () => "2026-01-01T00:00:00.000Z" });

    expect(result.items.find((item) => item.itemKey === "oats")?.quantity).toBe(4);
    expect(result.contributingEventIds).toEqual(["SHARED-1"]);
    expect(result.ignoredEventIds).toContain("E1");
    expect(result.exceptions.map((exception) => exception.code)).toEqual([
      "SUPERSEDED_EVENT_NOT_APPLIED",
      "TEST_RECORD_EXCLUDED",
    ]);
    expect(result.reconciliationStatus).toBe("EXCEPTIONS");
  });
});
