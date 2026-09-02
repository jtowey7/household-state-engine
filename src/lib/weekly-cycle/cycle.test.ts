import { describe, expect, it } from "vitest";

import { runWeeklyShadowCycle, weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from ".";
import { createMemoryProductionPort } from "../production-adapter";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { consumptionFixture } from "../consumption/fixtures";
import { shadowCatalogue } from "../procurement";
import { createAirtableProductionPort, createFakeAirtableRowSource } from "../production-adapter";

const opts = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

describe("weekly shadow cycle", () => {
  it("runs every stage end-to-end and produces an approvable proposal", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.status).toBe("COMPLETED");
    expect(run.stages.map((s) => s.stage)).toEqual([
      "LOAD_SOURCE",
      "PROJECT_CONSUMPTION",
      "RECEIVE_DELIVERY",
      "PROPOSE_APPEND",
      "REPLAY",
      "HANDOFF",
      "FEEDBACK_GATE",
      "QUANTITY_PLAN",
      "AGGREGATE_PROCUREMENT",
      "APPROVAL_GATE",
    ]);
    expect(run.stages.some((s) => s.status === "FAILED")).toBe(false);
    expect(run.plan?.requirements.length).toBeGreaterThan(0);
  });

  it("never mutates household state and never dispatches", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.source?.writable).toBe(false);
  });

  it("keeps human approval outside the calculation", async () => {
    const run = await runWeeklyShadowCycle(opts);
    expect(run.approval.required).toBe(true);
    expect(run.approval.granted).toBe(false);
    expect(run.basket?.readyForReview).toBe(true);
    expect(run.basket?.readyForApproval).toBe(false);
    expect(run.approval.readyForReview).toBe(false);
  });

  it("preserves provenance from source events to quantity requirements", async () => {
    const run = await runWeeklyShadowCycle(opts);
    const ids = run.plan!.requirements.flatMap((r) => r.sourceEventIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(run.snapshot!.contributingEventIds).toContain(id);
  });

  it("is deterministic: repeated runs share cycleId, snapshotId and planId", async () => {
    const a = await runWeeklyShadowCycle(opts);
    const b = await runWeeklyShadowCycle(opts);
    expect(b.cycleId).toBe(a.cycleId);
    expect(b.snapshot!.snapshotId).toBe(a.snapshot!.snapshotId);
    expect(b.plan!.planId).toBe(a.plan!.planId);
  });

  it("refuses the whole cycle when the source read is refused", async () => {
    const run = await runWeeklyShadowCycle({
      ...opts,
      port: createMemoryProductionPort({
        openingEvents: consumptionFixture.openingEvents ?? [],
        targets: shadowTargets,
        failWith: "connector offline",
      }),
    });
    expect(run.status).toBe("REFUSED");
    expect(run.plan).toBeNull();
    expect(run.approval.readyForReview).toBe(false);
    expect(run.stages.filter((s) => s.status === "SKIPPED")).toHaveLength(7);
    expect(run.basket).toBeNull();
  });

  it("isolates an uncertain item without blocking unrelated requirements", async () => {
    const run = await runWeeklyShadowCycle({
      ...opts,
      plan: {
        ...weeklyPlan,
        exceptions: [
          ...(weeklyPlan.exceptions ?? []),
          {
            exceptionId: "EXC-UNCERTAIN",
            type: "UNCERTAIN_QUANTITY",
            itemKey: "oats-rolled",
            occurredAt: "2026-08-03T10:00:00.000Z",
          },
        ],
      },
    });
    expect(run.isolatedItemKeys).toContain("oats-rolled");
    expect(run.handoff!.items.map((i) => i.itemKey)).not.toContain("oats-rolled");
    expect(run.status).toBe("COMPLETED");
  });

  it("refuses the approval gate when catalogue coverage is incomplete", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, catalogue: shadowCatalogue.slice(0, 2) });
    expect(run.basket!.readyForReview).toBe(true);
    expect(run.basket!.readyForApproval).toBe(false);
    expect(run.basket!.coverage.complete).toBe(false);
    expect(run.approval.readyForReview).toBe(false);
    const gate = run.stages.find((s) => s.stage === "APPROVAL_GATE")!;
    expect(gate.status).toBe("REFUSED");
    expect(gate.metrics["readyForReview"]).toBe(false);
  });

  it("refuses the quantity stage when replay is blocked by a reused Event ID", async () => {
    const opening = consumptionFixture.openingEvents ?? [];
    const conflict = { ...opening[0]!, eventId: "OPEN-DUP", payload: { quantity: 1, unit: "g" } };
    const conflictTwin = { ...conflict, payload: { quantity: 2, unit: "g" } };
    const run = await runWeeklyShadowCycle({
      ...opts,
      port: createMemoryProductionPort({
        openingEvents: [...opening, conflict, conflictTwin],
        targets: shadowTargets,
      }),
    });
    expect(run.source!.quarantinedItemKeys).toContain(conflict.itemKey);
    expect(run.plan!.requirements.map((r) => r.itemKey)).not.toContain(conflict.itemKey);
  });

  it("proves delivery can enter the shadow cycle only after the external purchase boundary", async () => {
    const delivery = {
      deliveryId: "DEL-HUMAN-1",
      deliveredAt: "2026-09-01T08:00:00.000Z",
      reconciliationStatus: "RECONCILED" as const,
      lines: [
        {
          lineId: "LINE-HUMAN-1",
          itemKey: "chicken",
          deliveredQuantity: 1000,
          unit: "g",
        },
      ],
    };
    const run = await runWeeklyShadowCycle({ ...opts, deliveries: [delivery] });
    const receive = run.stages.find((stage) => stage.stage === "RECEIVE_DELIVERY")!;

    expect(run.approval.granted).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.appendedEvents).toBe(false);
    expect(run.approval.readyForReview).toBe(false);
    expect(run.deliveryTransitions).toHaveLength(1);
    expect(run.deliveryTransitions[0]!.events[0]!.eventId).toBe("DEL-HUMAN-1::LINE-HUMAN-1");
    expect(receive.metrics["receiptEvents"]).toBe(1);
    expect(receive.metrics["written"]).toBe(0);
    expect(receive.metrics["mutatedProductionState"]).toBe(false);
    expect(run.snapshot!.contributingEventIds).toContain("DEL-HUMAN-1::LINE-HUMAN-1");
    expect(run.snapshot!.items.some((item) => item.itemKey === "chicken")).toBe(true);
  });

  it("produces a deterministic candidate basket that is never dispatched", async () => {
    const a = await runWeeklyShadowCycle(opts);
    const b = await runWeeklyShadowCycle(opts);
    expect(a.basket!.lines.length).toBeGreaterThan(0);
    expect(a.basket!.dispatched).toBe(false);
    expect(a.basket!.requiresHumanApproval).toBe(true);
    expect(b.basket!.basketId).toBe(a.basket!.basketId);
    expect(a.basket!.snapshotId).toBe(a.snapshot!.snapshotId);
  });

  it("carries provenance from source events all the way into basket lines", async () => {
    const run = await runWeeklyShadowCycle(opts);
    const ids = run.basket!.lines.flatMap((l) => l.sourceEventIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(run.snapshot!.contributingEventIds).toContain(id);
  });

  it("withholds an unsourceable item from the basket without losing the rest", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, catalogue: shadowCatalogue.slice(0, 2) });
    expect(run.basket!.exceptions.some((e) => e.code === "NO_CATALOGUE_MATCH")).toBe(true);
    expect(run.basket!.lines.length).toBeGreaterThan(0);
    expect(run.status).toBe("COMPLETED");
  });

  it("builds no basket when the catalogue cannot source anything", async () => {
    const run = await runWeeklyShadowCycle({ ...opts, catalogue: [] });
    expect(run.basket!.lines).toEqual([]);
    expect(run.approval.readyForReview).toBe(false);
  });

  it("reads real-shaped Airtable rows through the read-only port with no writes", async () => {
    const port = createAirtableProductionPort({
      mode: "SYNTHETIC",
      source: createFakeAirtableRowSource({
        eventRows: (consumptionFixture.openingEvents ?? []).map((e, i) => ({
          id: `rec${i}`,
          fields: {
            "Event ID": e.eventId,
            "Event type": "Receipt",
            "Occurred at": e.occurredAt,
            Item: e.itemKey,
            "Quantity delta": e.payload.quantity,
            Unit: e.payload.unit,
            "Record class": e.recordClass,
          },
        })),
      }),
    });
    const run = await runWeeklyShadowCycle({ ...opts, port, demandTargets: shadowTargets });
    expect(run.status).toBe("COMPLETED");
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.source!.writable).toBe(false);
    expect(run.basket!.dispatched).toBe(false);
  });

  it("records observability metrics for every stage", async () => {
    const run = await runWeeklyShadowCycle(opts);
    for (const stage of run.stages) {
      expect(typeof stage.detail).toBe("string");
      expect(stage.detail.length).toBeGreaterThan(0);
      expect(Array.isArray(stage.warnings)).toBe(true);
    }
    const replay = run.stages.find((s) => s.stage === "REPLAY")!;
    expect(replay.metrics["snapshotId"]).toBe(run.snapshot!.snapshotId);
  });
});

describe("PROPOSE_APPEND stage", () => {
  it("proposes canonical event rows and writes nothing", async () => {
    const run = await runWeeklyShadowCycle(opts);
    const stage = run.stages.find((s) => s.stage === "PROPOSE_APPEND");
    expect(stage).toBeDefined();
    expect(stage?.metrics["written"]).toBe(0);
    expect(stage?.metrics["requiresHumanAuthorization"]).toBe(true);
    expect(run.appendedEvents).toBe(false);
    expect(run.mutatedHouseholdState).toBe(false);
    for (const proposal of run.appendProposals) {
      expect(proposal.requiresHumanAuthorization).toBe(true);
      expect(proposal.receipt?.written ?? false).toBe(false);
      expect(proposal.receipt?.connector ?? null).toBeNull();
      if (proposal.record) {
        expect(proposal.record.row["Record class"]).toBe("Production");
        expect(proposal.record.eventId).toBe(proposal.record.row["Event ID"]);
      }
    }
  });

  it("is deterministic across identical runs", async () => {
    const a = await runWeeklyShadowCycle(opts);
    const b = await runWeeklyShadowCycle(opts);
    expect(a.appendProposals.map((p) => p.record?.eventId)).toEqual(
      b.appendProposals.map((p) => p.record?.eventId),
    );
  });
});
