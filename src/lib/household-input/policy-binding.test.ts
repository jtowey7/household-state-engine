import { describe, expect, it } from "vitest";
import {
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
} from "../event-writer/gate";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import type { ProductionEventAppendPort } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";

const now = () => "2026-09-14T05:00:00.000Z";

const deliverySubmission: HouseholdIntakeSubmission = {
  kind: "DELIVERY",
  input: {
    basketId: "basket-alpha-v1",
    orderReference: "ORDER-ALPHA-001",
    retailer: "Tesco",
    capturedAt: "2026-09-14T08:00:00.000Z",
    capturedBy: "household operator",
    delivery: {
      deliveryId: "delivery-alpha-001",
      dispatchId: "dispatch-alpha-001",
      basketId: "basket-alpha-v1",
      basketVersion: 1,
      basketFingerprint: "basket-fingerprint-alpha",
      deliveredAt: "2026-09-14T07:30:00.000Z",
      reconciliationStatus: "RECONCILED",
      lines: [
        { lineId: "line-1", itemKey: "Tesco Chicken Breast", deliveredQuantity: 2, unit: "pack" },
      ],
    },
  },
};

const stockCorrectionSubmission: HouseholdIntakeSubmission = {
  kind: "STOCK_CORRECTION",
  report: {
    exceptionId: "exc-001",
    itemKey: "Kerrygold Butter 250G",
    statedStateAfter: 100,
    unit: "g",
    evidence: "Counted the butter after breakfast.",
    observedAt: "2026-09-14T08:30:00.000Z",
    reportedBy: "household operator",
    source: "household stock check",
    reason: "Counted the butter after breakfast.",
  },
};

const approver = {
  authorizationId: "AUTH-POLICY-1",
  approvedBy: "household operator",
  approvedAt: "2026-09-14T09:00:00.000Z",
  evidenceDetail: "Explicit test approval for policy-binding regression.",
};

describe("household-input policy binding boundary", () => {
  it("a generic stock-correction approval request carries no Family Alpha policy binding", () => {
    const prepared = prepareHouseholdIntake(stockCorrectionSubmission, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    for (const request of prepared.approvalRequests) {
      expect(request.policyBinding).toBeUndefined();
    }
  });

  it("approving a generic stock correction cannot manufacture Family Alpha policy authority", () => {
    const prepared = prepareHouseholdIntake(stockCorrectionSubmission, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const authorization = authorizationFromRequest(prepared.approvalRequests[0]!, approver);
    expect(authorization.policyIdentity).toBeUndefined();
    expect(authorization.policyVersion).toBeUndefined();
    expect(authorization.eventId).toBe(prepared.approvalRequests[0]!.eventId);
    expect(authorization.payloadHash).toBe(prepared.approvalRequests[0]!.payloadHash);
  });

  it("the Family Alpha delivery path retains its required policy binding", () => {
    const prepared = prepareHouseholdIntake(deliverySubmission, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const request = prepared.approvalRequests[0]!;
    expect(request.policyBinding).toEqual({
      policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
      policyVersion: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
    });

    const authorization = authorizationFromRequest(request, approver);
    expect(authorization.policyIdentity).toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID);
    expect(authorization.policyVersion).toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION);
    expect(authorization.eventId).toBe(request.eventId);
    expect(authorization.payloadHash).toBe(request.payloadHash);
  });

  it("an explicitly approved routine stock correction still cannot reach a production connector without policy authority", async () => {
    const prepared = prepareHouseholdIntake(stockCorrectionSubmission, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    let appendCalls = 0;
    const port: ProductionEventAppendPort = {
      portId: "production-test-port",
      provenance: "PRODUCTION",
      async append() {
        appendCalls += 1;
        return { connectorRecordId: "must-not-be-written" };
      },
    };
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const authorization = authorizationFromRequest(prepared.approvalRequests[0]!, approver);

    const released = await releaseHouseholdIntake({
      submission: stockCorrectionSubmission,
      writer,
      approvals: [authorization],
      now,
    });

    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.appended).toBe(0);
    expect(released.written).toBe(false);
    expect(released.receipts).toHaveLength(1);
    expect(released.receipts[0]?.outcome).toBe("REJECTED");
    expect(released.receipts[0]?.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(appendCalls).toBe(0);
  });
});
