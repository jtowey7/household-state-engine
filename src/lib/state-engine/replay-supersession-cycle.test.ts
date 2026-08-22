import { describe, expect, it } from "vitest";
import { replayEvents, type HouseholdEvent } from "./index";

const now = () => "2026-01-01T00:00:00.000Z";

const event = (overrides: Partial<HouseholdEvent> & { eventId: string }): HouseholdEvent => ({
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "salmon",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { quantity: 1, unit: "g" },
  ...overrides,
});

describe("unresolvable supersession must block, not silently annihilate state", () => {
  it("blocks a two-event supersession cycle instead of dropping all evidence", () => {
    const result = replayEvents(
      [
        event({ eventId: "E1", supersedes: ["E2"], payload: { quantity: 780, unit: "g" } }),
        event({ eventId: "E2", supersedes: ["E1"], payload: { quantity: 500, unit: "g" } }),
      ],
      { now },
    );

    expect(result.reconciliationStatus).toBe("BLOCKED");
    expect(result.contributingEventIds).toEqual([]);
    expect(result.blockedItemKeys).toEqual(["salmon"]);
    expect(result.items.find((i) => i.itemKey === "salmon")?.blocked).toBe(true);
    expect(result.exceptions.map((x) => x.code)).toEqual([
      "SUPERSESSION_CYCLE_BLOCKED",
      "SUPERSESSION_CYCLE_BLOCKED",
    ]);
    expect(result.ignoredEventIds).toEqual(["E1", "E2"]);
  });

  it("blocks self-supersession", () => {
    const result = replayEvents(
      [event({ eventId: "E1", supersedes: ["E1"], payload: { quantity: 780, unit: "g" } })],
      { now },
    );
    expect(result.reconciliationStatus).toBe("BLOCKED");
    expect(result.exceptions.map((x) => x.code)).toEqual(["SUPERSESSION_CYCLE_BLOCKED"]);
    expect(result.blockedItemKeys).toEqual(["salmon"]);
  });

  it("leaves acyclic supersession and unrelated items untouched", () => {
    const result = replayEvents(
      [
        event({ eventId: "E1", payload: { quantity: 780, unit: "g" } }),
        event({ eventId: "E2", supersedes: ["E1"], payload: { quantity: 500, unit: "g" } }),
        event({ eventId: "B1", itemKey: "butter", payload: { quantity: 200, unit: "g" } }),
      ],
      { now },
    );

    expect(result.reconciliationStatus).toBe("EXCEPTIONS");
    expect(result.exceptions.map((x) => x.code)).toEqual(["SUPERSEDED_EVENT_NOT_APPLIED"]);
    expect(result.items.find((i) => i.itemKey === "salmon")?.quantity).toBe(500);
    expect(result.items.find((i) => i.itemKey === "butter")?.quantity).toBe(200);
    expect(result.blockedItemKeys).toEqual([]);
  });

  it("stays deterministic across repeated replays of a cyclic stream", () => {
    const events = [
      event({ eventId: "E1", supersedes: ["E2"] }),
      event({ eventId: "E2", supersedes: ["E1"] }),
    ];
    const a = replayEvents(events, { now });
    const b = replayEvents(events, { now });
    expect(b.snapshotId).toBe(a.snapshotId);
    expect(b.replayId).toBe(a.replayId);
  });
});
