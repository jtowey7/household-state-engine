import { describe, expect, it } from "vitest";
import { reconcileExpectedWithConfirmed } from "./ledger";
import type { ConsumptionEvidence, ExpectedConsumption } from "./types";
import type { HouseholdEvent } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter";

const NOW = () => "2026-01-10T00:00:00.000Z";
const ASOF = "2026-01-09T00:00:00.000Z";

const opening: HouseholdEvent[] = [
  {
    eventId: "OPEN:salmon",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "salmon",
    occurredAt: "2026-01-05T00:00:00.000Z",
    payload: { quantity: 780, unit: "g" },
  },
  {
    eventId: "OPEN:butter",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "butter",
    occurredAt: "2026-01-05T00:00:00.000Z",
    payload: { quantity: 250, unit: "g" },
  },
];

const expectSalmon: ExpectedConsumption = {
  expectationId: "EXP-SALMON-TUE",
  itemKey: "salmon",
  quantity: 780,
  unit: "g",
  expectedAt: "2026-01-06T18:00:00.000Z",
  sourceId: "MEAL-TUE",
};

const expectButter: ExpectedConsumption = {
  expectationId: "EXP-BUTTER-TUE",
  itemKey: "butter",
  quantity: 50,
  unit: "g",
  expectedAt: "2026-01-06T18:00:00.000Z",
  sourceId: "MEAL-TUE",
};

const confirmSalmon: ConsumptionEvidence = {
  evidenceId: "EV-SALMON-1",
  expectationId: "EXP-SALMON-TUE",
  itemKey: "salmon",
  observedQuantity: 780,
  unit: "g",
  observedAt: "2026-01-06T19:30:00.000Z",
  actor: "james",
  source: "meal completion",
  confidence: "OBSERVED",
};

const run = (evidence: ConsumptionEvidence[], expectations = [expectSalmon, expectButter]) =>
  reconcileExpectedWithConfirmed(
    { openingEvents: opening, expectations, evidence },
    { asOf: ASOF, now: NOW },
  );

describe("expected vs confirmed — clean path", () => {
  it("keeps expected and confirmed state in separate replays", () => {
    const r = run([confirmSalmon]);
    expect(r.expectedSnapshot.snapshotId).not.toBe(r.confirmedSnapshot.snapshotId);
    expect(r.expectedEvents.some((e) => e.eventId === "EXPECTED:EXP-SALMON-TUE")).toBe(true);
    expect(r.confirmedEvents.some((e) => e.eventId.startsWith("EXPECTED:"))).toBe(false);
    expect(r.confirmedEvents.some((e) => e.eventId === "CONFIRMED:EV-SALMON-1")).toBe(true);
  });

  it("reconciles matching evidence and preserves provenance", () => {
    const r = run([confirmSalmon]);
    const entry = r.entries.find((e) => e.expectationId === "EXP-SALMON-TUE")!;
    expect(entry.status).toBe("MATCHED");
    expect(entry.evidenceIds).toEqual(["EV-SALMON-1"]);
    expect(entry.delta).toBe(0);
    const salmon = r.confirmedSnapshot.items.find((i) => i.itemKey === "salmon")!;
    expect(salmon.quantity).toBe(0);
    expect(salmon.contributingEventIds).toEqual(["OPEN:salmon", "CONFIRMED:EV-SALMON-1"]);
  });

  it("forecasts expected and confirmed remaining stock separately", () => {
    const r = run([confirmSalmon]);
    const salmon = r.forecast.find((f) => f.itemKey === "salmon")!;
    expect(salmon).toMatchObject({ expectedRemaining: 0, confirmedRemaining: 0, status: "AGREED" });
    // butter is expected-burned but unconfirmed: never silently resolved.
    const butter = r.forecast.find((f) => f.itemKey === "butter")!;
    expect(butter.expectedRemaining).toBe(200);
    expect(butter.confirmedRemaining).toBe(250);
    expect(butter.divergence).toBe(-50);
    expect(butter.status).toBe("AWAITING_CONFIRMATION");
    expect(r.reconciliationStatus).toBe("EXCEPTIONS");
  });

  it("is deterministic across repeated runs", () => {
    expect(run([confirmSalmon])).toEqual(run([confirmSalmon]));
  });
});

describe("expected vs confirmed — divergence and conflict", () => {
  it("marks disagreement explicit and blocks the item", () => {
    const r = run([{ ...confirmSalmon, observedQuantity: 500 }]);
    const entry = r.entries.find((e) => e.expectationId === "EXP-SALMON-TUE")!;
    expect(entry.status).toBe("DIVERGED");
    expect(entry.expectedQuantity).toBe(780);
    expect(entry.confirmedQuantity).toBe(500);
    expect(entry.delta).toBe(-280);
    expect(entry.blocking).toBe(true);
    expect(r.blockedItemKeys).toContain("salmon");
    expect(r.reconciliationStatus).toBe("BLOCKED");
    // disagreement is not averaged away — both views stay visible
    const f = r.forecast.find((i) => i.itemKey === "salmon")!;
    expect(f.expectedRemaining).toBe(0);
    expect(f.confirmedRemaining).toBe(280);
  });

  it("refuses to confirm on insufficient evidence", () => {
    const r = run([{ ...confirmSalmon, confidence: "UNKNOWN" }]);
    const entry = r.entries.find((e) => e.status === "EVIDENCE_INSUFFICIENT")!;
    expect(entry.itemKey).toBe("salmon");
    expect(r.confirmedEvents.some((e) => e.eventId === "CONFIRMED:EV-SALMON-1")).toBe(false);
    expect(r.blockedItemKeys).toContain("salmon");
  });

  it("blocks on an incomparable evidence unit", () => {
    const r = run([{ ...confirmSalmon, unit: "kg", observedQuantity: 0.78 }]);
    expect(r.entries.some((e) => e.status === "UNIT_CONFLICT")).toBe(true);
    expect(r.confirmedEvents.some((e) => e.eventId === "CONFIRMED:EV-SALMON-1")).toBe(false);
  });

  it("records unplanned confirmed consumption as a non-blocking exception", () => {
    const r = run([
      confirmSalmon,
      {
        evidenceId: "EV-ICE-1",
        itemKey: "ice-cream",
        observedQuantity: 2,
        unit: "unit",
        observedAt: "2026-01-07T20:00:00.000Z",
        actor: "james",
        source: "household report",
        confidence: "REPORTED",
      },
    ]);
    const entry = r.entries.find((e) => e.itemKey === "ice-cream")!;
    expect(entry.status).toBe("UNEXPECTED_CONFIRMED");
    expect(entry.blocking).toBe(false);
    expect(r.blockedItemKeys).not.toContain("ice-cream");
  });
});

describe("evidence delivery semantics", () => {
  it("is idempotent for an identical duplicate delivery", () => {
    const once = run([confirmSalmon]);
    const twice = run([confirmSalmon, { ...confirmSalmon }]);
    expect(twice.confirmedSnapshot.snapshotId).toBe(once.confirmedSnapshot.snapshotId);
    expect(twice.entries).toEqual(once.entries);
    expect(twice.handoff).toEqual(once.handoff);
  });

  it("treats a reused evidence id with a changed payload as a conflict", () => {
    const r = run([confirmSalmon, { ...confirmSalmon, observedQuantity: 100 }]);
    const conflict = r.entries.find((e) => e.status === "EVIDENCE_PAYLOAD_CONFLICT")!;
    expect(conflict.evidenceIds).toEqual(["EV-SALMON-1"]);
    expect(r.blockedItemKeys).toContain("salmon");
    // only the first delivery mutated confirmed state
    expect(r.confirmedEvents.filter((e) => e.eventId === "CONFIRMED:EV-SALMON-1")).toHaveLength(1);
  });

  it("gives Record class = Test evidence and expectations zero effect", () => {
    const base = run([confirmSalmon]);
    const withTest = run([
      confirmSalmon,
      { ...confirmSalmon, evidenceId: "EV-TEST", observedQuantity: 999, recordClass: "Test" },
    ]);
    expect(withTest.confirmedSnapshot.snapshotId).toBe(base.confirmedSnapshot.snapshotId);
    expect(withTest.blockedItemKeys).toEqual(base.blockedItemKeys);
  });
});

describe("downstream quantity boundary", () => {
  const targets = [
    { itemKey: "salmon", targetQuantity: 780, unit: "g" },
    { itemKey: "butter", targetQuantity: 250, unit: "g" },
  ];

  it("hands off confirmed state only, and procures for unrelated items", () => {
    const r = run([confirmSalmon]);
    const plan = adaptSnapshotToQuantityRun(r.handoff, {
      targets,
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(plan.snapshotId).toBe(r.confirmedSnapshot.snapshotId);
    const salmon = plan.requirements.find((q) => q.itemKey === "salmon")!;
    expect(salmon.onHandQuantity).toBe(0);
    expect(salmon.requiredQuantity).toBe(780);
    expect(salmon.sourceEventIds).toContain("CONFIRMED:EV-SALMON-1");
  });

  it("blocks the diverged item downstream while others keep planning", () => {
    const r = run([{ ...confirmSalmon, observedQuantity: 500 }]);
    const plan = adaptSnapshotToQuantityRun(r.handoff, {
      targets,
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(plan.requirements.some((q) => q.itemKey === "salmon")).toBe(false);
    expect(plan.rejections.some((x) => x.code === "ITEM_ISOLATED" && x.itemKey === "salmon")).toBe(
      true,
    );
    expect(plan.requirements.some((q) => q.itemKey === "butter")).toBe(true);
  });

  it("refuses the whole run under the conservative default policy", () => {
    const r = run([{ ...confirmSalmon, observedQuantity: 500 }]);
    const plan = adaptSnapshotToQuantityRun(r.handoff, { targets });
    expect(plan.executed).toBe(false);
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections[0]!.code).toBe("RECONCILIATION_BLOCKED");
  });
});
