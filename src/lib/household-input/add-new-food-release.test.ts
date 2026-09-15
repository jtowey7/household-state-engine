/**
 * Live acceptance case (2026-09-15, deployed /food):
 *
 *   "Ham", 100, "g" — a genuinely NEW food, no existing match — was prepared
 *   as `Correction · Ham · no quantity change stated` and then refused at the
 *   write boundary.
 *
 * Two defects are covered here:
 *   1. the stated amount must be read back from the canonical row, so the
 *      review step states the real amount and never "no quantity change";
 *   2. an explicit household stock intake carries its own narrow policy
 *      (household-stock-input:v1) and must actually persist — while remaining
 *      unable to borrow Family Alpha delivery authority.
 */

import { describe, expect, it } from "vitest";

import { createHouseholdEventWriter } from "../event-writer/writer";
import {
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
  HOUSEHOLD_STOCK_INPUT_POLICY_ID,
  HOUSEHOLD_STOCK_INPUT_POLICY_VERSION,
} from "../event-writer/gate";
import type {
  CanonicalAppendRecord,
  PortAppendAck,
  ProductionEventAppendPort,
} from "../event-writer/types";
import { resolveAddedAmount } from "../food-ui/add-food-quantity";
import { authorizationFromRequest, prepareHouseholdIntake } from "./intake";
import { releaseHouseholdIntake } from "./intake";
import type { HouseholdIntakeSubmission } from "./types";

const now = () => "2026-09-15T19:00:00.000Z";

function productionPort(): ProductionEventAppendPort & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  return {
    portId: "test-production-port",
    provenance: "PRODUCTION",
    rows,
    async append(record: CanonicalAppendRecord): Promise<PortAppendAck> {
      rows.push(record.row as unknown as Record<string, unknown>);
      return { connectorRecordId: `rec-${rows.length}` };
    },
  };
}

/** Exactly what /food builds for a brand-new food with an explicit amount. */
function hamSubmission(stateAfter: number): HouseholdIntakeSubmission {
  return {
    kind: "STOCK_CORRECTION",
    report: {
      exceptionId: "HOUSEHOLD-STOCK-ham-live-001",
      itemKey: "Ham",
      statedStateAfter: stateAfter,
      unit: "g",
      observedAt: "2026-09-15T19:00:00.000Z",
      reportedBy: "household operator",
      source: "FoodOS household inventory",
      evidence: "Household operator explicitly reported new food added from the household control surface.",
      confidence: "High",
      reason: "Explicit household action: new food added to household stock.",
      recordClass: "Production",
    },
  };
}

const approver = {
  authorizationId: "AUTH-HAM-1",
  approvedBy: "household operator",
  approvedAt: "2026-09-15T19:00:30.000Z",
  evidenceDetail: "Household operator explicitly approved the exact stock change shown on the food screen.",
};

describe("adding a brand-new food with an explicit amount", () => {
  it("treats 100 g of a food nobody has yet as the whole amount", () => {
    const added = resolveAddedAmount({ item: "Ham", quantity: 100, unit: "g", existing: [] });
    expect(added).toEqual({ ok: true, stateAfter: 100, stateBefore: null, matchedItem: null });
  });

  it("states the real amount in the review step, never 'no quantity change stated'", () => {
    const prepared = prepareHouseholdIntake(hamSubmission(100), { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const request = prepared.approvalRequests[0]!;
    expect(request.summary).not.toContain("no quantity change stated");
    expect(request.summary).toContain("100 g");
    expect(request.householdSummary).toBe("Ham — 100 g");
    expect(request.householdSummary).not.toMatch(/Correction|MISSING|payload|event/i);
  });

  it("persists through the real write boundary and reads back the stated amount", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const prepared = prepareHouseholdIntake(hamSubmission(100), { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const approvals = prepared.approvalRequests.map((request) => {
      expect(request.policyBinding?.policyIdentity).toBe(HOUSEHOLD_STOCK_INPUT_POLICY_ID);
      expect(request.policyBinding?.policyVersion).toBe(HOUSEHOLD_STOCK_INPUT_POLICY_VERSION);
      expect(request.policyBinding?.policyIdentity).not.toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID);
      return authorizationFromRequest(request, approver);
    });

    const released = await releaseHouseholdIntake({
      submission: hamSubmission(100),
      writer,
      approvals,
      now,
    });

    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.written).toBe(true);
    expect(released.appended).toBe(1);
    expect(released.rejected).toBe(0);
    expect(port.rows).toHaveLength(1);
    expect(port.rows[0]!["Item"]).toBe("Ham");
    expect(port.rows[0]!["Unit"]).toBe("g");
    expect(port.rows[0]!["State after"]).toBe("100");
    expect(port.rows[0]!["Record class"]).toBe("Production");
  });

  it("is idempotent when the same stated amount is released twice", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const prepared = prepareHouseholdIntake(hamSubmission(100), { now });
    if (!prepared.ok) throw new Error("preparation failed");
    const approvals = prepared.approvalRequests.map((r) => authorizationFromRequest(r, approver));

    const first = await releaseHouseholdIntake({ submission: hamSubmission(100), writer, approvals, now });
    const second = await releaseHouseholdIntake({ submission: hamSubmission(100), writer, approvals, now });

    expect(first.ok && first.written).toBe(true);
    expect(second.ok && second.ok && second.duplicates).toBe(1);
    expect(port.rows).toHaveLength(1);
  });

  it("cannot use household stock authority to write a delivery-scoped row", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const prepared = prepareHouseholdIntake(hamSubmission(100), { now });
    if (!prepared.ok) throw new Error("preparation failed");
    const base = authorizationFromRequest(prepared.approvalRequests[0]!, approver);

    for (const forged of [
      { ...base, policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID },
      { ...base, authorizationScope: "FAMILY_ALPHA_HOUSEHOLD_EVENT" as const },
      { ...base, policyVersion: 99 },
    ]) {
      const receipt = await writer.append(prepared.records[0]!, forged);
      expect(receipt.written).toBe(false);
      expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    }
    expect(port.rows).toHaveLength(0);
  });
});
