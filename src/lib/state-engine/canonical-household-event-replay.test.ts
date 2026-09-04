import { describe, expect, it } from "vitest";
import { prepareHouseholdIntake } from "../household-input/intake";
import type { HouseholdIntakeSubmission } from "../household-input/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { replayEvents } from "./engine";
import { canonicalRecordToHouseholdEvent } from "./canonical-household-event-replay";

const now = () => "2026-09-04T00:00:00.000Z";

const stockCorrection: HouseholdIntakeSubmission = {
  kind: "STOCK_CORRECTION",
  report: {
    exceptionId: "EXC-OATS-001",
    itemKey: "oats-rolled",
    statedStateAfter: 1500,
    unit: "g",
    observedAt: "2026-09-03T23:55:00.000Z",
    reportedBy: "James",
    source: "Household stock check",
    evidence: "Physical cupboard count: 1.5 kg rolled oats on hand.",
    confidence: "High",
    reason: "Manual household stock reconciliation",
    recordClass: "Production",
  },
};

describe("canonical household event -> replay -> quantity vertical", () => {
  it("carries explicit household stock input through the canonical event ledger shape into quantity requirements", () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.records).toHaveLength(1);
    expect(prepared.requiresHumanAuthorization).toBe(true);
    expect(prepared.productionMutation).toBe(false);

    const mapped = canonicalRecordToHouseholdEvent(prepared.records[0]!);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const snapshot = replayEvents([mapped.event], { now });
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
    expect(snapshot.items).toMatchObject([
      {
        itemKey: "oats-rolled",
        quantity: 1500,
        unit: "g",
        contributingEventIds: [prepared.records[0]!.eventId],
        blocked: false,
      },
    ]);

    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: shadowTargets.filter((target) => target.itemKey === "oats-rolled"),
    });
    expect(plan.executed).toBe(true);
    expect(plan.eligibleForProcurement).toBe(true);
    expect(plan.requirements).toEqual([
      expect.objectContaining({
        itemKey: "oats-rolled",
        onHandQuantity: 1500,
        targetQuantity: 2000,
        requiredQuantity: 500,
        unit: "g",
        sourceEventIds: [prepared.records[0]!.eventId],
      }),
    ]);
  });

  it("refuses malformed canonical records before replay", () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const malformed = {
      ...prepared.records[0]!,
      row: { ...prepared.records[0]!.row, Item: "" },
    };
    const mapped = canonicalRecordToHouseholdEvent(malformed);
    expect(mapped).toEqual({
      ok: false,
      code: "INVALID_CANONICAL_RECORD",
      detail: "Record is not a canonical HOUSEHOLD_EVENTS capability.",
    });
  });

  it("refuses a forged clone even when its structural fields look canonical", () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const forgedClone = {
      ...prepared.records[0]!,
      row: {
        ...prepared.records[0]!.row,
        Item: "forged-oats",
        Unit: "kg",
        "State after": 99,
      },
      payloadHash: "forged-payload-hash",
    };

    const mapped = canonicalRecordToHouseholdEvent(forgedClone);
    expect(mapped).toEqual({
      ok: false,
      code: "INVALID_CANONICAL_RECORD",
      detail: "Record is not a canonical HOUSEHOLD_EVENTS capability.",
    });
  });
});
