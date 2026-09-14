import { describe, expect, it } from "vitest";
import {
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
} from "../event-writer/gate";
import { authorizationFromRequest, prepareHouseholdIntake } from "./intake";
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
});
