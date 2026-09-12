import { describe, expect, it } from "vitest";
import { buildHouseholdStockReadout } from "./readout";
import type { StockEntryInput } from "./types";

const now = () => "2026-09-05T10:00:00.000Z";
const options = { now, reportedBy: "household operator" };

function entry(over: Partial<StockEntryInput> = {}): StockEntryInput {
  return {
    entryId: "entry-1",
    itemKey: "Chicken Breast",
    quantity: 4,
    unit: "pack",
    observedAt: "2026-09-05T09:30:00.000Z",
    ...over,
  };
}

describe("household stock input → readout", () => {
  it("proposes an entry without approval and keeps it out of the readout state", () => {
    const result = buildHouseholdStockReadout([entry()], options);

    expect(result.proposals).toHaveLength(1);
    expect(result.awaitingApproval).toHaveLength(1);
    expect(result.productionMutation).toBe(false);
    expect(result.requiresHumanAuthorization).toBe(true);
    expect(result.proposals[0]!.recordClass).toBe("Test");
    expect(result.proposals[0]!.preview.wouldWrite).toBe(false);
    expect(result.snapshot.items).toHaveLength(0);
    expect(result.handoff.items).toHaveLength(0);
    expect(result.lines[0]!.approved).toBe(false);
  });

  it("materialises approved entries into the readout and the quantity handoff", () => {
    const result = buildHouseholdStockReadout(
      [entry({ approved: true }), entry({ entryId: "entry-2", itemKey: "Rice", quantity: 900, unit: "g", approved: true })],
      options,
    );

    expect(result.rejections).toHaveLength(0);
    expect(result.awaitingApproval).toHaveLength(0);
    expect(result.snapshot.reconciliationStatus).toBe("CLEAN");
    expect(result.handoff.readyForQuantityRun).toBe(true);
    expect(result.handoff.items.map((i) => [i.itemKey, i.quantity, i.unit])).toEqual([
      ["Chicken Breast", 4, "pack"],
      ["Rice", 900, "g"],
    ]);
    const chicken = result.lines.find((l) => l.itemKey === "Chicken Breast")!;
    expect(chicken.approved).toBe(true);
    expect(chicken.quantity).toBe(4);
    expect(chicken.blocked).toBe(false);
    expect(result.productionMutation).toBe(false);
  });

  it("fails closed on an ambiguous or incomplete entry without affecting other entries", () => {
    const result = buildHouseholdStockReadout(
      [
        entry({ entryId: "bad-1", quantity: "about half a pack", approved: true }),
        entry({ entryId: "bad-2", itemKey: "Milk", quantity: 2, unit: "", approved: true }),
        entry({ entryId: "good-1", itemKey: "Rice", quantity: 900, unit: "g", approved: true }),
      ],
      options,
    );

    expect(result.rejections.map((r) => r.exceptionId).sort()).toEqual(["bad-1", "bad-2"]);
    expect(result.snapshot.items.map((i) => i.itemKey)).toEqual(["Rice"]);
    expect(result.handoff.items).toHaveLength(1);
  });

  it("is deterministic and idempotent for the same approved entries", () => {
    const entries = [entry({ approved: true })];
    const a = buildHouseholdStockReadout(entries, options);
    const b = buildHouseholdStockReadout(entries, options);

    expect(b.snapshot.snapshotId).toBe(a.snapshot.snapshotId);
    expect(b.snapshot.replayId).toBe(a.snapshot.replayId);
    expect(b.proposals[0]!.eventId).toBe(a.proposals[0]!.eventId);
    expect(b.proposals[0]!.payloadHash).toBe(a.proposals[0]!.payloadHash);
  });
});
