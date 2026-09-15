/**
 * Regression proof for the canonical policy gap.
 *
 * ACTION POLICY authorises routine consumption at PREPARE/TEST only. A generic
 * STOCK_CORRECTION approval therefore carries no Production policy binding, and
 * must NEVER be able to append a Production HOUSEHOLD EVENT — even when a real
 * PRODUCTION-provenance connector and a PRODUCTION_WRITE writer are present.
 *
 * The legitimate Family Alpha delivery binding must remain able to write.
 */

import { describe, expect, it } from "vitest";

import { createHouseholdEventWriter } from "../event-writer/writer";
import type {
  CanonicalAppendRecord,
  PortAppendAck,
  ProductionEventAppendPort,
} from "../event-writer/types";
import {
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
  HOUSEHOLD_STOCK_INPUT_POLICY_ID,
} from "../event-writer/gate";
import { authorizationFromRequest, prepareHouseholdIntake } from "./intake";
import type { HouseholdIntakeSubmission } from "./types";

const now = () => "2026-09-14T05:00:00.000Z";

function productionPort(): ProductionEventAppendPort & { calls: CanonicalAppendRecord[] } {
  const calls: CanonicalAppendRecord[] = [];
  return {
    portId: "test-production-port",
    provenance: "PRODUCTION",
    calls,
    async append(record): Promise<PortAppendAck> {
      calls.push(record);
      return { connectorRecordId: `rec-${calls.length}` };
    },
  };
}

const stockCorrection: HouseholdIntakeSubmission = {
  kind: "STOCK_CORRECTION",
  report: {
    exceptionId: "exc-regression-001",
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

const delivery: HouseholdIntakeSubmission = {
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

const approver = {
  authorizationId: "AUTH-REGRESSION-1",
  approvedBy: "household operator",
  approvedAt: "2026-09-14T09:00:00.000Z",
  evidenceDetail: "Explicit household approval captured in the review step.",
};

describe("a stock-correction approval carries only household stock authority", () => {
  it("writes under its own household policy, never the Family Alpha one", async () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const request = prepared.approvalRequests[0]!;
    expect(request.policyBinding?.policyIdentity).toBe(HOUSEHOLD_STOCK_INPUT_POLICY_ID);
    expect(request.policyBinding?.policyIdentity).not.toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID);

    const authorization = authorizationFromRequest(request, approver);
    expect(authorization.authorizationScope).toBe("HOUSEHOLD_STOCK_INPUT");

    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await writer.append(prepared.records[0]!, authorization);

    expect(receipt.written).toBe(true);
    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(port.calls).toHaveLength(1);
  });

  it("cannot be smuggled through by forging only one half of the policy binding", async () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const base = authorizationFromRequest(prepared.approvalRequests[0]!, approver);

    for (const forged of [
      { ...base, policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID },
      { ...base, authorizationScope: "FAMILY_ALPHA_HOUSEHOLD_EVENT" as const },
      { ...base, policyIdentity: "family-alpha-household-event:legacy", policyVersion: 1 },
      { ...base, policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID, policyVersion: 2 },
      { ...base, authorizationScope: undefined },
    ]) {
      const port = productionPort();
      const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
      const receipt = await writer.append(prepared.records[0]!, forged);

      expect(receipt.written).toBe(false);
      expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
      expect(port.calls).toHaveLength(0);
    }
  });

  it("still allows the legitimate Family Alpha delivery policy binding to write", async () => {
    const prepared = prepareHouseholdIntake(delivery, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const request = prepared.approvalRequests[0]!;
    expect(request.policyBinding).toEqual({
      policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
      policyVersion: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
      authorizationScope: "FAMILY_ALPHA_HOUSEHOLD_EVENT",
    });

    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await writer.append(
      prepared.records[0]!,
      authorizationFromRequest(request, approver),
    );

    expect(receipt.written).toBe(true);
    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(port.calls).toHaveLength(1);
  });
});
