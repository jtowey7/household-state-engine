import { describe, expect, it } from "vitest";
import {
  replayEvents,
  toQuantityRequirementsHandoff,
  type HouseholdEvent,
} from "./index";

const NOW = () => "2026-01-01T00:00:00.000Z";

const ev = (o: Partial<HouseholdEvent> & { eventId: string }): HouseholdEvent => ({
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "oats",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payload: { quantity: 1, unit: "kg" },
  ...o,
});

const base: HouseholdEvent[] = [
  ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 2, unit: "kg" } }),
  ev({
    eventId: "E2",
    itemKey: "milk",
    eventType: "ITEM_STOCK_DELTA",
    payload: { quantity: 3, unit: "l" },
  }),
];

describe("deterministic repeatability", () => {
  it("produces identical replayId/snapshotId/state across replays", () => {
    const a = replayEvents(base, { now: NOW });
    const b = replayEvents(base, { now: NOW });
    expect(a).toEqual(b);
    expect(a.replayId).toBe(b.replayId);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(a.reconciliationStatus).toBe("CLEAN");
  });

  it("changes snapshotId when state changes", () => {
    const a = replayEvents(base, { now: NOW });
    const c = replayEvents([...base, ev({ eventId: "E3", itemKey: "rice" })], { now: NOW });
    expect(c.snapshotId).not.toBe(a.snapshotId);
  });
});

describe("duplicate delivery", () => {
  it("applies an identical duplicate Event ID at most once", () => {
    const dup = replayEvents([...base, base[0]!], { now: NOW });
    const once = replayEvents(base, { now: NOW });
    expect(dup.items).toEqual(once.items);
    expect(dup.contributingEventIds).toEqual(["E1", "E2"]);
    expect(dup.ignoredEventIds).toEqual(["E1"]);
    expect(dup.exceptions.map((x) => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
    expect(dup.reconciliationStatus).toBe("EXCEPTIONS");
  });

  it("is observationally idempotent: identity is unchanged", () => {
    const dup = replayEvents([...base, base[0]!, base[0]!], { now: NOW });
    const once = replayEvents(base, { now: NOW });
    expect(dup.replayId).toBe(once.replayId);
    expect(dup.snapshotId).toBe(once.snapshotId);
    const a = toQuantityRequirementsHandoff(dup);
    const b = toQuantityRequirementsHandoff(once);
    expect(a.items).toEqual(b.items);
    expect(a.replayId).toBe(b.replayId);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(a.readyForQuantityRun).toBe(true);
  });

  it("a reused Event ID with a different payload DOES change identity", () => {
    const conflict = replayEvents(
      [...base, ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 99, unit: "kg" } })],
      { now: NOW },
    );
    const once = replayEvents(base, { now: NOW });
    expect(conflict.replayId).not.toBe(once.replayId);
    expect(conflict.snapshotId).not.toBe(once.snapshotId);
    expect(conflict.reconciliationStatus).toBe("BLOCKED");
  });

  it("Test records have zero effect on canonical identity", () => {
    const withTest = replayEvents(
      [...base, ev({ eventId: "T9", recordClass: "Test", payload: { quantity: 99, unit: "kg" } })],
      { now: NOW },
    );
    const once = replayEvents(base, { now: NOW });
    expect(withTest.replayId).toBe(once.replayId);
    expect(withTest.snapshotId).toBe(once.snapshotId);
    expect(withTest.exceptions.map((x) => x.code)).toEqual(["TEST_RECORD_EXCLUDED"]);
  });
});

describe("reused Event ID with different payload", () => {
  const conflicted = replayEvents(
    [...base, ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 99, unit: "kg" } })],
    { now: NOW },
  );

  it("causes no second mutation", () => {
    expect(conflicted.items.find((i) => i.itemKey === "oats")!.quantity).toBe(2);
    expect(conflicted.contributingEventIds).toEqual(["E1", "E2"]);
  });

  it("records an explicit blocking data-integrity conflict", () => {
    const x = conflicted.exceptions[0]!;
    expect(x.code).toBe("REUSED_EVENT_ID_PAYLOAD_CONFLICT");
    expect(x.blocking).toBe(true);
    expect(conflicted.reconciliationStatus).toBe("BLOCKED");
  });
});

describe("Record class = Test", () => {
  it("has zero effect on materialised state", () => {
    const withTest = replayEvents(
      [
        ...base,
        ev({
          eventId: "T1",
          recordClass: "Test",
          itemKey: "oats",
          payload: { quantity: 1000, unit: "kg" },
        }),
      ],
      { now: NOW },
    );
    const clean = replayEvents(base, { now: NOW });
    expect(withTest.items).toEqual(clean.items);
    expect(withTest.contributingEventIds).toEqual(clean.contributingEventIds);
    expect(withTest.exceptions.map((x) => x.code)).toEqual(["TEST_RECORD_EXCLUDED"]);
  });

  it("Test events cannot supersede production events", () => {
    const r = replayEvents(
      [
        ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 2, unit: "kg" } }),
        ev({ eventId: "T2", recordClass: "Test", supersedes: ["E1"] }),
      ],
      { now: NOW },
    );
    expect(r.contributingEventIds).toEqual(["E1"]);
  });

  it("a Test Event ID cannot suppress a later Production event", () => {
    const r = replayEvents(
      [
        ev({ eventId: "SHARED-1", recordClass: "Test", payload: { quantity: 999, unit: "kg" } }),
        ev({ eventId: "SHARED-1", recordClass: "Production", itemKey: "oats", payload: { quantity: 4, unit: "kg" } }),
      ],
      { now: NOW },
    );

    expect(r.items.find((i) => i.itemKey === "oats")!.quantity).toBe(4);
    expect(r.contributingEventIds).toEqual(["SHARED-1"]);
    expect(r.blockedItemKeys).toEqual([]);
    expect(r.reconciliationStatus).toBe("EXCEPTIONS");
    expect(r.exceptions.map((x) => x.code)).toEqual(["TEST_RECORD_EXCLUDED"]);
  });
});

describe("supersession", () => {
  it("does not apply superseded events, even when they arrive first", () => {
    const r = replayEvents(
      [
        ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 2, unit: "kg" } }),
        ev({
          eventId: "E9",
          itemKey: "oats",
          payload: { quantity: 5, unit: "kg" },
          supersedes: ["E1"],
        }),
      ],
      { now: NOW },
    );
    expect(r.contributingEventIds).toEqual(["E9"]);
    expect(r.ignoredEventIds).toEqual(["E1"]);
    expect(r.items[0]!.quantity).toBe(5);
    expect(r.exceptions.map((x) => x.code)).toEqual(["SUPERSEDED_EVENT_NOT_APPLIED"]);
  });
});

describe("unresolved conflict blocking", () => {
  const r = replayEvents(
    [
      ...base,
      ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 42, unit: "kg" } }),
    ],
    { now: NOW },
  );

  it("blocks only the affected item downstream", () => {
    expect(r.blockedItemKeys).toEqual(["oats"]);
    const handoff = toQuantityRequirementsHandoff(r);
    expect(handoff.readyForQuantityRun).toBe(false);
    expect(handoff.items.map((i) => i.itemKey)).toEqual(["milk"]);
    expect(handoff.blockedItemKeys).toEqual(["oats"]);
  });
});

describe("evidence precision", () => {
  it("preserves qualified evidence on the materialised item and blocks its handoff", () => {
    const r = replayEvents(
      [
        ev({
          eventId: "QUAL-1",
          itemKey: "oats",
          payload: {
            quantity: 2,
            unit: "kg",
            evidencePrecision: "QUALIFIED_AMBIGUOUS",
          },
        }),
        ev({
          eventId: "EXACT-1",
          itemKey: "milk",
          payload: { quantity: 3, unit: "l", evidencePrecision: "EXACT" },
        }),
      ],
      { now: NOW },
    );

    const oats = r.items.find((item) => item.itemKey === "oats")!;
    const milk = r.items.find((item) => item.itemKey === "milk")!;
    expect(oats.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
    expect(oats.blocked).toBe(true);
    expect(milk.evidencePrecision).toBe("EXACT");
    expect(milk.blocked).toBe(false);
    expect(r.blockedItemKeys).toEqual(["oats"]);
    expect(r.exceptions).toEqual([
      expect.objectContaining({
        code: "QUALIFIED_AMBIGUOUS_EVIDENCE",
        eventId: "QUAL-1",
        itemKey: "oats",
        blocking: true,
      }),
    ]);

    const handoff = toQuantityRequirementsHandoff(r);
    expect(handoff.readyForQuantityRun).toBe(false);
    expect(handoff.items).toEqual([
      {
        itemKey: "milk",
        quantity: 3,
        unit: "l",
        evidencePrecision: "EXACT",
        sourceEventIds: ["EXACT-1"],
      },
    ]);
  });

  it("propagates qualified precision through later deltas", () => {
    const r = replayEvents(
      [
        ev({
          eventId: "QUAL-1",
          payload: { quantity: 2, unit: "kg", evidencePrecision: "QUALIFIED_AMBIGUOUS" },
        }),
        ev({
          eventId: "DELTA-1",
          eventType: "ITEM_STOCK_DELTA",
          payload: { quantity: -1, unit: "kg" },
        }),
      ],
      { now: NOW },
    );

    expect(r.items[0]!.quantity).toBe(1);
    expect(r.items[0]!.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
    expect(r.blockedItemKeys).toEqual(["oats"]);
    expect(r.exceptions.filter((x) => x.code === "QUALIFIED_AMBIGUOUS_EVIDENCE")).toHaveLength(2);
  });
});

describe("provenance preservation", () => {
  it("keeps contributing event IDs per item in application order", () => {
    const r = replayEvents(
      [
        ev({ eventId: "E1", itemKey: "oats", payload: { quantity: 2, unit: "kg" } }),
        ev({
          eventId: "E2",
          itemKey: "oats",
          eventType: "ITEM_STOCK_DELTA",
          payload: { quantity: 1 },
        }),
      ],
      { now: NOW },
    );
    const oats = r.items[0]!;
    expect(oats.contributingEventIds).toEqual(["E1", "E2"]);
    expect(oats.lastAppliedEventId).toBe("E2");
    expect(oats.quantity).toBe(3);
    expect(oats.unit).toBe("kg");
    expect(oats.evidencePrecision).toBe("EXACT");
  });
});

describe("QUANTITY REQUIREMENTS handoff", () => {
  it("emits replay identity, timestamp, evidence precision and source event IDs", () => {
    const snapshot = replayEvents(base, { now: NOW });
    const handoff = toQuantityRequirementsHandoff(snapshot);
    expect(handoff).toEqual({
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: "2026-01-01T00:00:00.000Z",
      reconciliationStatus: "CLEAN",
      readyForQuantityRun: true,
      items: [
        {
          itemKey: "milk",
          quantity: 3,
          unit: "l",
          evidencePrecision: "EXACT",
          sourceEventIds: ["E2"],
        },
        {
          itemKey: "oats",
          quantity: 2,
          unit: "kg",
          evidencePrecision: "EXACT",
          sourceEventIds: ["E1"],
        },
      ],
      blockedItemKeys: [],
    });
  });

  it("excludes removed items", () => {
    const r = replayEvents(
      [...base, ev({ eventId: "E3", itemKey: "milk", eventType: "ITEM_REMOVED", payload: {} })],
      { now: NOW },
    );
    expect(toQuantityRequirementsHandoff(r).items.map((i) => i.itemKey)).toEqual(["oats"]);
  });
});
