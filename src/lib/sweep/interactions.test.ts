import { describe, expect, it } from "vitest";

import {
  evidenceFromSweepTap,
  evidenceFromTellReport,
  outcomeForItem,
  outcomesFor,
  runSweep,
} from "./interactions";
import { SWEEP_ITEMS } from "./fixtures";

const at = "2026-02-10T18:30:00.000Z";

describe("Quick Stock Sweep — evidence, never silent mutation", () => {
  it("clean path: confirming the Tuesday salmon as planned matches the expectation", () => {
    const ev = evidenceFromSweepTap({
      evidenceId: "SWEEP-1",
      itemKey: "salmon-fillet",
      action: "USED_AS_PLANNED",
      observedAt: at,
    });
    expect(ev.observedQuantity).toBe(780);
    expect(ev.confidence).toBe("OBSERVED");

    const run = runSweep([ev]);
    const outcome = outcomeForItem(run, "salmon-fillet");
    expect(outcome?.status).toBe("CONFIRMED");
    expect(run.confirmedSnapshot.items.find((i) => i.itemKey === "salmon-fillet")?.quantity).toBe(0);
    expect(run.blockedItemKeys).not.toContain("salmon-fillet");
  });

  it("divergence path: 'Gone' on Haribo confirms more than planned and isolates the item", () => {
    const run = runSweep([
      evidenceFromSweepTap({
        evidenceId: "SWEEP-2",
        itemKey: "haribo",
        action: "GONE",
        observedAt: at,
      }),
    ]);
    const outcome = outcomeForItem(run, "haribo");
    expect(outcome?.status).toBe("DIVERGED");
    expect(outcome?.expectedQuantity).toBe(60);
    expect(outcome?.confirmedQuantity).toBe(300);
    expect(run.blockedItemKeys).toContain("haribo");
    expect(run.handoff.items.some((i) => i.itemKey === "haribo")).toBe(false);
  });

  it("expected and confirmed remain distinct in the forecast", () => {
    const run = runSweep([]);
    const salmon = run.forecast.find((f) => f.itemKey === "salmon-fillet")!;
    expect(salmon.expectedRemaining).toBe(0);
    expect(salmon.confirmedRemaining).toBe(780);
    expect(salmon.divergence).toBe(-780);
    expect(salmon.status).not.toBe("AGREED");
  });

  it("an untouched, not-yet-due item is awaiting confirmation, not confirmed", () => {
    const run = runSweep([]);
    expect(outcomeForItem(run, "gem-lettuce")?.status).toBe("AWAITING_CONFIRMATION");
  });

  it("'Different quantity' with no number cannot confirm anything and blocks the item", () => {
    const run = runSweep([
      evidenceFromSweepTap({
        evidenceId: "SWEEP-3",
        itemKey: "salmon-fillet",
        action: "DIFFERENT_QUANTITY",
        quantity: null,
        observedAt: at,
      }),
    ]);
    expect(outcomeForItem(run, "salmon-fillet")?.status).toBe("BLOCKED");
  });

  it("repeat delivery of the same tap is idempotent", () => {
    const ev = evidenceFromSweepTap({
      evidenceId: "SWEEP-4",
      itemKey: "salmon-fillet",
      action: "USED_AS_PLANNED",
      observedAt: at,
    });
    const once = runSweep([ev]);
    const twice = runSweep([ev, { ...ev }]);
    expect(twice.confirmedSnapshot.snapshotId).toBe(once.confirmedSnapshot.snapshotId);
    expect(outcomesFor(twice)).toEqual(outcomesFor(once));
  });

  it("every fixture is clearly a synthetic demo item with a unit", () => {
    for (const item of SWEEP_ITEMS) {
      expect(item.unit).toBeTruthy();
      expect(item.openingQuantity).toBeGreaterThan(0);
    }
  });
});

describe("Tell Food OS — reports are recorded, not trusted blindly", () => {
  it("'Used something' with a quantity confirms against the plan", () => {
    const run = runSweep([
      evidenceFromTellReport({
        evidenceId: "TELL-1",
        intent: "USED_SOMETHING",
        itemKey: "haribo",
        quantity: 60,
        observedAt: at,
      }),
    ]);
    expect(outcomeForItem(run, "haribo")?.status).toBe("CONFIRMED");
  });

  it("'Bought something' produces insufficient evidence and isolates the item", () => {
    const ev = evidenceFromTellReport({
      evidenceId: "TELL-2",
      intent: "BOUGHT_SOMETHING",
      itemKey: "gem-lettuce",
      observedAt: at,
      text: "picked up another lettuce",
    });
    expect(ev.confidence).toBe("UNKNOWN");
    const run = runSweep([ev]);
    expect(run.blockedItemKeys).toContain("gem-lettuce");
    expect(outcomeForItem(run, "gem-lettuce")?.status).toBe("BLOCKED");
  });

  it("free text is preserved as provenance on the evidence object", () => {
    const ev = evidenceFromTellReport({
      evidenceId: "TELL-3",
      intent: "FREE_TEXT",
      itemKey: "gem-lettuce",
      observedAt: at,
      text: "  lettuce looks past it  ",
      actor: "James",
    });
    expect(ev.note).toBe("lettuce looks past it");
    expect(ev.actor).toBe("James");
    expect(ev.source).toBe("tell-food-os:FREE_TEXT");
  });

  it("one blocked item does not block an unrelated confirmed item", () => {
    const run = runSweep([
      evidenceFromTellReport({
        evidenceId: "TELL-4",
        intent: "BOUGHT_SOMETHING",
        itemKey: "gem-lettuce",
        observedAt: at,
      }),
      evidenceFromSweepTap({
        evidenceId: "SWEEP-5",
        itemKey: "salmon-fillet",
        action: "USED_AS_PLANNED",
        observedAt: at,
      }),
    ]);
    expect(outcomeForItem(run, "salmon-fillet")?.status).toBe("CONFIRMED");
    expect(run.blockedItemKeys).toContain("gem-lettuce");
    expect(run.blockedItemKeys).not.toContain("salmon-fillet");
  });
});
