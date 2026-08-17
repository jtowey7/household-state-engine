import { describe, it, expect } from "vitest";
import { runShadowHouseholdCycle, runShadowHouseholdCycleWithProposals, shadowQuantityFor } from "./shadow-run";
import {
  BANANAS,
  BUTTER,
  ICE_CREAM,
  SALMON,
  declaredEventRows,
  declaredPlan,
  exceptionOnlyPlan,
  salmonCorrectionRow,
} from "./case";

describe("shadow household cycle (declared input, isolated output)", () => {
  it("A: a completed planned meal burns the Tuesday salmon to 0 g", async () => {
    const run = await runShadowHouseholdCycle();
    const salmon = shadowQuantityFor(run, SALMON);
    expect(salmon?.quantity).toBe(0);
    expect(salmon?.unit).toBe("g");
    // Provenance: delivery + plan-derived consumption, both by immutable id.
    expect(salmon?.contributingEventIds).toEqual([
      "EVT-2026-08-11-SALMON-DELIVERY",
      "CONSUME:MEAL-2026-08-11-DINNER:" + SALMON + ":g",
    ]);
  });

  it("B: the same fact expressed as a consumption exception also lands on 0 g", async () => {
    const run = await runShadowHouseholdCycle({ plan: exceptionOnlyPlan });
    expect(shadowQuantityFor(run, SALMON)?.quantity).toBe(0);
  });

  it("C: an Airtable Correction with `State after` 0 also lands on 0 g", async () => {
    const run = await runShadowHouseholdCycle({
      rows: [...declaredEventRows, salmonCorrectionRow],
      plan: { meals: [] },
    });
    expect(shadowQuantityFor(run, SALMON)?.quantity).toBe(0);
  });

  it("never writes household state and never dispatches", async () => {
    const run = await runShadowHouseholdCycle();
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.approval.required).toBe(true);
    expect(run.approval.granted).toBe(false);
    expect(run.source?.writable).toBe(false);
  });

  it("is deterministic across repeated runs", async () => {
    const a = await runShadowHouseholdCycle();
    const b = await runShadowHouseholdCycle();
    expect(b.cycleId).toBe(a.cycleId);
    expect(b.snapshot?.snapshotId).toBe(a.snapshot?.snapshotId);
    expect(b.plan?.planId).toBe(a.plan?.planId);
    expect(b.basket?.basketId).toBe(a.basket?.basketId);
  });

  it("daily allocation burns one ice cream per person per day", async () => {
    const run = await runShadowHouseholdCycle();
    // 12 delivered − (1 × 2 people × 2 days) = 8.
    expect(shadowQuantityFor(run, ICE_CREAM)?.quantity).toBe(8);
  });

  it("unplanned consumption is an exception event, not an inventory edit", async () => {
    const run = await runShadowHouseholdCycle();
    expect(shadowQuantityFor(run, BUTTER)?.quantity).toBe(200);
    expect(shadowQuantityFor(run, BUTTER)?.contributingEventIds).toContain(
      "EXC:EXC-2026-08-11-BUTTER",
    );
  });

  it("no leftovers are invented for the completed meal", async () => {
    const run = await runShadowHouseholdCycle();
    const ids = run.snapshot?.contributingEventIds ?? [];
    expect(ids.some((id) => id.startsWith("LEFTOVER"))).toBe(false);
  });

  it("an uncertain item is isolated without stopping unrelated planning", async () => {
    const run = await runShadowHouseholdCycle();
    expect(run.isolatedItemKeys).toContain(BANANAS);
    expect(run.handoff?.items.some((i) => i.itemKey === BANANAS)).toBe(false);
    // Unrelated items still produced requirements.
    expect(run.plan?.executed).toBe(true);
    expect(run.plan?.requirements.some((r) => r.itemKey === SALMON)).toBe(true);
  });

  it("Test-class rows have zero effect on shadow state", async () => {
    const run = await runShadowHouseholdCycle();
    expect(run.snapshot?.contributingEventIds).not.toContain("EVT-TEST-SALMON-NOISE");
  });

  it("a Confirmation row never moves stock", async () => {
    const run = await runShadowHouseholdCycle();
    expect(run.snapshot?.contributingEventIds).not.toContain(
      "EVT-2026-08-11-SALMON-CONFIRMATION",
    );
    expect(
      run.source?.rejections.some(
        (r) => r.code === "UNSUPPORTED_EVENT_TYPE" && !r.quarantines,
      ),
    ).toBe(true);
  });

  it("duplicate delivery of the same declared row is idempotent", async () => {
    const first = declaredEventRows[0]!;
    const run = await runShadowHouseholdCycle({
      rows: [...declaredEventRows, { id: "recSALMON001-dup", fields: { ...first.fields } }],
    });
    expect(shadowQuantityFor(run, SALMON)?.quantity).toBe(0);
  });

  it("the salmon requirement reaches a candidate basket for human review only", async () => {
    const run = await runShadowHouseholdCycle();
    const req = run.plan?.requirements.find((r) => r.itemKey === SALMON);
    expect(req?.requiredQuantity).toBe(780);
    expect(run.basket).not.toBeNull();
    expect(run.approval.granted).toBe(false);
  });

  it("declared plan is a fixture and can never claim production provenance", async () => {
    const run = await runShadowHouseholdCycle();
    expect(run.scope.mode).toBe("SYNTHETIC");
    expect(declaredPlan.meals?.length).toBeGreaterThan(0);
  });
});

describe("shadow cycle proposedAppend preview", () => {
  it("exposes preview-only append proposals and writes nothing", async () => {
    const { run, proposedAppend } = await runShadowHouseholdCycleWithProposals();
    expect(proposedAppend.length).toBeGreaterThan(0);
    for (const prepared of proposedAppend) {
      expect(prepared.wouldWrite).toBe(false);
      expect(prepared.requiresHumanAuthorization).toBe(true);
      expect(prepared.preview.request.tableLabel).toBe("HOUSEHOLD EVENTS");
      expect(Object.keys(prepared.preview.row)).toHaveLength(19);
      expect(prepared.preview.row["Event ID"]).toBe(prepared.eventId);
    }
    for (const proposal of run.appendProposals) {
      expect(proposal.receipt?.written ?? false).toBe(false);
    }
  });
});
