import { describe, expect, it } from "vitest";
import {
  proposeStockExceptionCorrections,
  proposalKeyFor,
  type UserReportedStockException,
} from "./index";

const now = () => "2026-08-12T09:00:00.000Z";

/** Synthetic salmon exception: the user says the tray is actually empty. */
const salmonZero: UserReportedStockException = {
  exceptionId: "EXC-SALMON-001",
  itemKey: "Salmon fillet",
  statedStateAfter: 0,
  unit: "g",
  observedAt: "2026-08-11T18:30:00.000Z",
  reportedBy: "James Towey",
  source: "User-reported stock exception",
  evidence: "James checked the fridge drawer: the salmon tray is empty.",
  reason: "User-reported stock exception: item exhausted earlier than plan",
};

function run(reports: UserReportedStockException[], known?: Parameters<typeof proposeStockExceptionCorrections>[1]["knownProposals"]) {
  return proposeStockExceptionCorrections(reports, { now, ...(known ? { knownProposals: known } : {}) });
}

describe("user-reported inventory exception -> canonical Correction proposal", () => {
  it("maps an 'item is actually 0' report to a Correction preview that would not write", () => {
    const result = run([salmonZero]);
    expect(result.rejections).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    const p = result.proposals[0]!;
    expect(p.intent.eventType).toBe("Correction");
    expect(p.stateAfter).toBe(0);
    expect(p.preview.wouldWrite).toBe(false);
    expect(p.preview.requiresHumanAuthorization).toBe(true);
    expect(p.requiresHumanAuthorization).toBe(true);

    const row = p.preview.preview.row;
    expect(row["Event type"]).toBe("Correction");
    expect(row.Item).toBe("Salmon fillet");
    expect(row["State after"]).toBe("0");
    expect(row.Unit).toBe("g");
    expect(row["Occurred at"]).toBe(salmonZero.observedAt);
    expect(row.Actor).toBe("James Towey");
    expect(row.Source).toBe("User-reported stock exception");
    expect(row.Evidence).toContain("the salmon tray is empty");
    expect(row.Confidence).toBe("High");
    expect(row["Exception / reconciliation action"]).toBe(salmonZero.reason);
    expect(row["Record class"]).toBe("Production");
    expect(row["Quantity delta"]).toBeNull();
    expect(p.preview.preview.request.tableLabel).toBe("HOUSEHOLD EVENTS");
  });

  it("maps a non-zero state-after report and preserves the stated prior state", () => {
    const result = run([
      { ...salmonZero, exceptionId: "EXC-SALMON-002", statedStateAfter: 220, statedStateBefore: 780 },
    ]);
    expect(result.rejections).toEqual([]);
    const p = result.proposals[0]!;
    expect(p.stateAfter).toBe(220);
    expect(p.preview.preview.row["State after"]).toBe("220");
    expect(p.preview.preview.row["State before"]).toBe("780");
  });

  it("refuses a missing quantity and an ambiguous quantity without inventing one", () => {
    const missing = run([{ ...salmonZero, statedStateAfter: null }]);
    expect(missing.proposals).toEqual([]);
    expect(missing.rejections.map((r) => r.code)).toEqual(["MISSING_QUANTITY"]);

    const ambiguous = run([{ ...salmonZero, statedStateAfter: "about half a pack" }]);
    expect(ambiguous.proposals).toEqual([]);
    expect(ambiguous.rejections.map((r) => r.code)).toEqual(["AMBIGUOUS_QUANTITY"]);

    const negative = run([{ ...salmonZero, statedStateAfter: -5 }]);
    expect(negative.rejections.map((r) => r.code)).toEqual(["INVALID_QUANTITY"]);
  });

  it("refuses a report with no explicit user evidence, and one with no unit", () => {
    const noEvidence = run([{ ...salmonZero, evidence: "   " }]);
    expect(noEvidence.proposals).toEqual([]);
    expect(noEvidence.rejections.map((r) => r.code)).toEqual(["MISSING_EVIDENCE"]);

    const noUnit = run([{ ...salmonZero, unit: null }]);
    expect(noUnit.proposals).toEqual([]);
    expect(noUnit.rejections.map((r) => r.code)).toEqual(["MISSING_UNIT"]);
  });

  it("is idempotent: repeated evaluation of the same exception dedupes", () => {
    const first = run([salmonZero]);
    const second = run([salmonZero], first.fingerprints);
    expect(second.proposals).toEqual([]);
    expect(second.deduped).toHaveLength(1);
    expect(second.deduped[0]!.eventId).toBe(first.proposals[0]!.eventId);
    expect(second.rejections).toEqual([]);
    expect(second.fingerprints).toEqual(first.fingerprints);
    expect(first.fingerprints[0]!.proposalKey).toBe(proposalKeyFor("EXC-SALMON-001", "Salmon fillet"));
  });

  it("surfaces a conflict when the same exception restates a different quantity", () => {
    const first = run([salmonZero]);
    const changed = run([{ ...salmonZero, statedStateAfter: 120 }], first.fingerprints);
    expect(changed.proposals).toEqual([]);
    expect(changed.rejections.map((r) => r.code)).toEqual(["EXCEPTION_PAYLOAD_CONFLICT"]);
    expect(changed.rejections[0]!.detail).toContain(first.proposals[0]!.eventId);
  });

  it("surfaces a conflict when evidence/provenance materially changes", () => {
    const first = run([salmonZero]);
    const changed = run(
      [{ ...salmonZero, evidence: "Reported second-hand by another household member." }],
      first.fingerprints,
    );
    expect(changed.proposals).toEqual([]);
    expect(changed.rejections.map((r) => r.code)).toEqual(["EXCEPTION_PROVENANCE_CONFLICT"]);
  });

  it("carries explicit supersession through and never infers it", () => {
    const plain = run([salmonZero]).proposals[0]!;
    expect(plain.preview.preview.row["Supersedes event ID"]).toEqual([]);

    const superseding = run([{ ...salmonZero, supersedes: ["EVT-2026-08-11-SALMON-FILLET-CONSUMPTION-abc12345"] }]);
    const p = superseding.proposals[0]!;
    expect(p.preview.preview.row["Supersedes event ID"]).toEqual([
      "EVT-2026-08-11-SALMON-FILLET-CONSUMPTION-abc12345",
    ]);
    // Explicit supersession is part of canonical identity.
    expect(p.eventId).not.toBe(plain.eventId);
  });

  it("isolates Test-class reports in their own identity space", () => {
    const prod = run([salmonZero]).proposals[0]!;
    const test = run([{ ...salmonZero, recordClass: "Test" }]).proposals[0]!;
    expect(test.preview.preview.row["Record class"]).toBe("Test");
    expect(test.eventId.startsWith("TEST-")).toBe(true);
    expect(prod.eventId.startsWith("EVT-")).toBe(true);
    expect(test.eventId).not.toBe(prod.eventId);
    expect(test.payloadHash).not.toBe(prod.payloadHash);
  });

  it("is deterministic across repeated runs", () => {
    expect(run([salmonZero]).proposals[0]!.record).toEqual(run([salmonZero]).proposals[0]!.record);
  });
});

describe("weekly/shadow cycle carries exception corrections as proposals only", () => {
  it("proposes the Correction, writes nothing and mutates no inventory", async () => {
    const { runShadowHouseholdCycle } = await import("../shadow-household/shadow-run");
    const report: UserReportedStockException = {
      exceptionId: "EXC-BUTTER-001",
      itemKey: "Butter",
      statedStateAfter: 0,
      unit: "g",
      observedAt: "2026-08-12T08:00:00.000Z",
      reportedBy: "James Towey",
      source: "User-reported stock exception",
      evidence: "James looked in the butter dish: empty.",
      reason: "User-reported stock exception: butter exhausted",
    };
    const run = await runShadowHouseholdCycle({ stockExceptions: [report] });

    expect(run.exceptionProposals?.proposals).toHaveLength(1);
    const proposed = run.exceptionProposals!.proposals[0]!;
    expect(proposed.preview.wouldWrite).toBe(false);
    expect(proposed.requiresHumanAuthorization).toBe(true);
    expect(run.appendProposals.some((p) => p.record?.eventId === proposed.eventId)).toBe(true);
    for (const p of run.appendProposals) {
      expect(p.receipt?.written ?? false).toBe(false);
      expect(p.receipt?.inventoryMutated ?? false).toBe(false);
    }
    expect(run.appendedEvents).toBe(false);
    expect(run.mutatedHouseholdState).toBe(false);
    expect(run.dispatched).toBe(false);
    expect(run.approval.granted).toBe(false);
  });

  it("does not queue a Test-class report into the production proposal stream", async () => {
    const { runShadowHouseholdCycle } = await import("../shadow-household/shadow-run");
    const report: UserReportedStockException = {
      exceptionId: "EXC-BUTTER-TEST",
      itemKey: "Butter",
      statedStateAfter: 0,
      unit: "g",
      observedAt: "2026-08-12T08:00:00.000Z",
      reportedBy: "Synthetic harness",
      source: "Synthetic exception fixture",
      evidence: "Synthetic Test-class report.",
      reason: "Test-class exception",
      recordClass: "Test",
    };
    const run = await runShadowHouseholdCycle({ stockExceptions: [report] });
    const testEventId = run.exceptionProposals!.proposals[0]!.eventId;
    expect(testEventId.startsWith("TEST-")).toBe(true);
    expect(run.appendProposals.some((p) => p.record?.eventId === testEventId)).toBe(false);
  });
});
