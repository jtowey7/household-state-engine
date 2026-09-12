/**
 * MVP CUTOVER acceptance: household stock input + readout.
 *
 * Fixtures are synthetic and local-only. No connector, no Production household
 * mutation and no retailer I/O is reachable from these modules.
 */
import { describe, expect, it } from "vitest";
import { describeStockApprovalBoundary } from "./approval-boundary";
import { buildHouseholdStockReadout } from "./readout";
import type { StockEntryInput } from "./types";

const now = () => "2026-09-12T10:00:00.000Z";
const options = { now, reportedBy: "James" };

function entry(over: Partial<StockEntryInput> = {}): StockEntryInput {
  return {
    entryId: "entry-butter",
    itemKey: "Butter",
    quantity: 250,
    unit: "g",
    observedAt: "2026-09-12T09:30:00.000Z",
    ...over,
  };
}

describe("MVP acceptance — entering a stock correction", () => {
  it("A1: an entered correction is a proposal only and never writes", () => {
    const readout = buildHouseholdStockReadout([entry()], options);

    expect(readout.productionMutation).toBe(false);
    expect(readout.proposals).toHaveLength(1);
    expect(readout.proposals[0]!.preview.wouldWrite).toBe(false);
    expect(readout.proposals[0]!.recordClass).toBe("Test");
    expect(readout.snapshot.items).toHaveLength(0);
  });

  it("A2: the approval boundary states the exact Event ID and payload hash required", () => {
    const readout = buildHouseholdStockReadout([entry()], options);
    const boundary = describeStockApprovalBoundary([entry()], options);

    expect(boundary.productionMutation).toBe(false);
    expect(boundary.requiresHumanAuthorization).toBe(true);
    const line = boundary.lines[0]!;
    expect(line.refusal).toBeNull();
    expect(line.request!.eventId).toBe(readout.proposals[0]!.eventId);
    expect(line.request!.payloadHash).toBe(readout.proposals[0]!.payloadHash);
    expect(line.request!.requiredEvidenceSource).toBe("EXPLICIT_USER_INPUT");
    expect(line.request!.actionPolicyReference).toContain("explicit human approval required");
    // A request carries no decision and no approver.
    expect(Object.keys(line.request!)).not.toContain("decision");
    expect(Object.keys(line.request!)).not.toContain("approvedBy");
  });

  it("A3: confirming an entry puts exactly that amount into the readable inventory", () => {
    const readout = buildHouseholdStockReadout(
      [entry({ approved: true }), entry({ entryId: "entry-rice", itemKey: "Rice", quantity: 900 })],
      options,
    );

    const confirmed = readout.lines.filter((line) => line.approved);
    expect(confirmed.map((l) => [l.itemKey, l.quantity, l.unit])).toEqual([["Butter", 250, "g"]]);
    expect(readout.handoff.readyForQuantityRun).toBe(true);
    expect(readout.handoff.items.map((i) => i.itemKey)).toEqual(["Butter"]);
    // The unconfirmed entry stays visible but out of state.
    expect(readout.lines.some((l) => l.itemKey === "Rice" && !l.approved)).toBe(true);
  });

  it("A4: a vague entry is refused and isolated at the approval boundary too", () => {
    const entries = [
      entry({ entryId: "vague", quantity: "a bit left", approved: true }),
      entry({ entryId: "entry-rice", itemKey: "Rice", quantity: 900, approved: true }),
    ];
    const readout = buildHouseholdStockReadout(entries, options);
    const boundary = describeStockApprovalBoundary(entries, options);

    expect(readout.rejections.map((r) => r.exceptionId)).toEqual(["vague"]);
    expect(readout.snapshot.items.map((i) => i.itemKey)).toEqual(["Rice"]);

    const vague = boundary.lines.find((l) => l.entryId === "vague")!;
    expect(vague.request).toBeNull();
    expect(vague.refusal).toContain("AMBIGUOUS_QUANTITY");
    const rice = boundary.lines.find((l) => l.entryId === "entry-rice")!;
    expect(rice.request).not.toBeNull();
  });

  it("A5: re-reading the same entries is deterministic and idempotent", () => {
    const entries = [entry({ approved: true })];
    const a = buildHouseholdStockReadout(entries, options);
    const b = buildHouseholdStockReadout(entries, options);
    const ba = describeStockApprovalBoundary(entries, options);
    const bb = describeStockApprovalBoundary(entries, options);

    expect(b.snapshot.snapshotId).toBe(a.snapshot.snapshotId);
    expect(b.snapshot.replayId).toBe(a.snapshot.replayId);
    expect(bb.lines[0]!.request!.payloadHash).toBe(ba.lines[0]!.request!.payloadHash);
  });

  it("A6: a later correction of the same item supersedes the earlier count in the readout", () => {
    const readout = buildHouseholdStockReadout(
      [
        entry({ approved: true }),
        entry({
          entryId: "entry-butter-2",
          quantity: 0,
          observedAt: "2026-09-12T09:45:00.000Z",
          approved: true,
        }),
      ],
      options,
    );

    const butter = readout.handoff.items.filter((i) => i.itemKey === "Butter");
    expect(butter).toHaveLength(1);
    expect(butter[0]!.quantity).toBe(0);
    expect(readout.productionMutation).toBe(false);
  });
});
