/**
 * Integration: synthetic opening stock + projected consumption events
 *   → replayEvents → toQuantityRequirementsHandoff → adaptSnapshotToQuantityRun
 *
 * Complements (does not duplicate) src/lib/test-lab/harness.test.ts, which covers
 * the same contract on hand-written event streams. Here the events come from the
 * consumption projector, so the whole vertical slice is exercised end-to-end.
 * SYNTHETIC fixtures only — no Airtable, no real household state, no dispatch.
 */
import { describe, expect, it } from "vitest";
import { projectConsumptionEvents } from "../consumption/projector";
import { consumptionAsOf, consumptionFixture } from "../consumption/fixtures";
import { runReplayToQuantityIntegration } from "../test-lab/harness";
import { adaptSnapshotToQuantityRun } from "./adapter";
import { shadowRun } from "./shadow-run";
import type { DemandTarget } from "./types";
import type { HouseholdEvent } from "../state-engine/types";

const NOW = () => "2026-01-01T00:00:00.000Z";

/** SYNTHETIC demand targets for the consumption slice. */
const targets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" },
  { itemKey: "ice-cream-tub", targetQuantity: 20, unit: "count", packSize: 4, packUnit: "count" },
  { itemKey: "rice-basmati", targetQuantity: 5000, unit: "g", packSize: 1000, packUnit: "g" },
];

const projected = (): HouseholdEvent[] =>
  projectConsumptionEvents(consumptionFixture, { asOf: consumptionAsOf }).events;

const integrate = (events: readonly HouseholdEvent[]) =>
  runReplayToQuantityIntegration(events, { targets, now: NOW });

describe("consumption → replay → quantity integration", () => {
  it("(1) normal replay produces a quantity plan from burned-down stock", () => {
    const run = integrate(projected());
    expect(run.reconciliationStatus).toBe("CLEAN");
    expect(run.plan.executed).toBe(true);
    expect(run.plan.eligibleForProcurement).toBe(true);
    const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    // 1200 opening − 300 (MEAL-3001) − 300 (MEAL-3002) = 600 on hand.
    expect(oats.onHandQuantity).toBe(600);
    expect(oats.requiredQuantity).toBe(1400);
    // Existing pack-rounding/aggregation behaviour is preserved, not re-implemented.
    expect(oats.packCount).toBe(3);
    expect(oats.packRoundedQuantity).toBe(1500);
    // Durable cupboard stock met its target, so no procurement line.
    expect(run.plan.requirements.map((r) => r.itemKey)).not.toContain("rice-basmati");
  });

  it("(2) snapshot/replay identity and source event IDs survive into the plan", () => {
    const run = integrate(projected());
    expect(run.plan.snapshotId).toBe(run.snapshot.snapshotId);
    expect(run.plan.replayId).toBe(run.snapshot.replayId);
    expect(run.plan.replayTimestamp).toBe(run.snapshot.replayTimestamp);
    expect(run.plan.reconciliationStatus).toBe(run.snapshot.reconciliationStatus);
    const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    expect(oats.sourceEventIds).toEqual([
      "OPEN-OATS",
      "CONSUME:MEAL-3001:oats-rolled:g",
      "CONSUME:MEAL-3002:oats-rolled:g",
    ]);
    const milk = run.plan.requirements.find((r) => r.itemKey === "milk-whole")!;
    expect(milk.sourceEventIds).toContain("EXC:EXC-7001");
  });

  it("(3) an identical duplicate consumption event is idempotent", () => {
    const events = projected();
    const duplicated = [...events, events.find((e) => e.eventId.startsWith("CONSUME:"))!];
    const once = integrate(events);
    const twice = integrate(duplicated);
    expect(twice.plan.requirements).toEqual(once.plan.requirements);
    expect(twice.snapshot.exceptions.map((x) => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
    expect(twice.plan.executed).toBe(true);
  });

  it("(4) reused Event ID with a different payload blocks and refuses procurement", () => {
    const events = projected();
    const target = events.find((e) => e.eventId === "CONSUME:MEAL-3001:oats-rolled:g")!;
    const run = integrate([
      ...events,
      { ...target, payload: { ...target.payload, quantity: -9999 } },
    ]);
    expect(run.reconciliationStatus).toBe("BLOCKED");
    expect(run.snapshot.blockedItemKeys).toEqual(["oats-rolled"]);
    expect(run.snapshot.items.find((i) => i.itemKey === "oats-rolled")!.quantity).toBe(600);
    expect(run.plan.executed).toBe(false);
    expect(run.plan.eligibleForProcurement).toBe(false);
    expect(run.plan.requirements).toEqual([]);
    expect(run.plan.rejections.map((r) => r.code)).toEqual(["RECONCILIATION_BLOCKED"]);
    expect(run.dispatched).toBe(false);
  });

  it("(5) Test recordClass events have zero effect on the quantity plan", () => {
    const clean = integrate(projected());
    const withTest = integrate([
      ...projected(),
      {
        eventId: "TEST-9999",
        recordClass: "Test",
        eventType: "ITEM_STOCK_SET",
        itemKey: "oats-rolled",
        occurredAt: "2026-08-03T12:00:00.000Z",
        payload: { quantity: 999999, unit: "g" },
      },
    ]);
    expect(withTest.plan.requirements).toEqual(clean.plan.requirements);
    expect(withTest.sourceEventIds).not.toContain("TEST-9999");
    expect(withTest.snapshot.exceptions.map((x) => x.code)).toEqual(["TEST_RECORD_EXCLUDED"]);
  });

  it("(6) superseded consumption events are excluded from the quantity plan", () => {
    const events = projected();
    const supersededId = "CONSUME:MEAL-3002:oats-rolled:g";
    const run = integrate([
      ...events,
      {
        eventId: "CORRECTION-1",
        recordClass: "Production",
        eventType: "ITEM_STOCK_SET",
        itemKey: "oats-rolled",
        occurredAt: "2026-08-03T13:00:00.000Z",
        payload: { quantity: 900, unit: "g" },
        supersedes: [supersededId],
      },
    ]);
    const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    expect(oats.onHandQuantity).toBe(900);
    expect(oats.sourceEventIds).not.toContain(supersededId);
    expect(run.snapshot.exceptions.map((x) => x.code)).toEqual([
      "SUPERSEDED_EVENT_NOT_APPLIED",
    ]);
  });

  it("(7) identical shadow runs produce identical plan and snapshot IDs, and never dispatch", () => {
    const a = shadowRun(projected(), targets, { now: NOW });
    const b = shadowRun(projected(), targets, { now: NOW });
    expect(a).toEqual(b);
    expect(a.plan.planId).toBe(b.plan.planId);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(a.replayId).toBe(b.replayId);
    expect(a.dispatched).toBe(false);
    expect(b.dispatched).toBe(false);
  });

  it("(8) no static INVENTORY fallback when the snapshot is missing", () => {
    for (const input of [null, undefined] as const) {
      const plan = adaptSnapshotToQuantityRun(input, { targets });
      expect(plan.requirements).toEqual([]);
      expect(plan.executed).toBe(false);
      expect(plan.eligibleForProcurement).toBe(false);
      expect(plan.rejections).toEqual([
        {
          code: "MISSING_REPLAY_SNAPSHOT",
          itemKey: null,
          detail:
            "No replay snapshot supplied; the adapter refuses to fall back to static inventory.",
          fatal: true,
        },
      ]);
    }
    // An empty replay is not a licence to invent ON-HAND quantities: every
    // configured target is treated as on-hand 0 with no source provenance,
    // rather than silently omitted from procurement.
    const empty = integrate([]);
    expect(empty.plan.requirements.map((r) => r.itemKey)).toEqual(
      [...targets].map((t) => t.itemKey).sort(),
    );
    for (const req of empty.plan.requirements) {
      expect(req.onHandQuantity).toBe(0);
      expect(req.sourceEventIds).toEqual([]);
    }
  });
});
