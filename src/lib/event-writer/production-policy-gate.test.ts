import { describe, expect, it } from "vitest";

import { authorizeAppend, FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID, FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION } from "./gate";
import { canonicaliseAppend } from "./canonical";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-08-27T05:00:00.000Z";

const productionIntent: AppendIntent = {
  eventType: "Consumption",
  item: "Kerrygold Butter 250G",
  occurredAt: "2026-08-27T04:30:00.000Z",
  quantityDelta: -50,
  unit: "g",
  source: "Family Alpha supermarket transaction",
  actor: "Food OS state engine",
  evidence: "transaction receipt",
  recordClass: "Production",
};

function canonical() {
  const result = canonicaliseAppend(productionIntent, { now });
  if (!result.ok) throw new Error(`fixture must canonicalise: ${result.rejection.code}`);
  return result.record;
}

function baseProductionRequest() {
  const record = canonical();
  return {
    record,
    target: "PRODUCTION_WRITE" as const,
    decision: "APPROVED" as const,
    approvedBy: "James",
    approvedAt: now(),
    evidenceSource: "STRONG_TRANSACTION_EVIDENCE" as const,
    evidenceDetail: "Tesco receipt and transaction evidence",
    actionPolicyReference: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
    authorizationId: "AUTH-FAMILY-ALPHA",
    policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
    policyVersion: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
    credentialAvailable: true,
  };
}

describe("Family Alpha production policy gate", () => {
  it("requires the exact canonical policy identity and version", () => {
    expect(authorizeAppend({ ...baseProductionRequest(), policyIdentity: undefined })).toMatchObject({
      granted: false,
      refusal: { code: "POLICY_ID_REQUIRED" },
    });

    expect(authorizeAppend({ ...baseProductionRequest(), policyIdentity: "family-alpha-household-event:legacy" })).toMatchObject({
      granted: false,
      refusal: { code: "POLICY_ID_MISMATCH" },
    });

    expect(authorizeAppend({ ...baseProductionRequest(), policyVersion: undefined })).toMatchObject({
      granted: false,
      refusal: { code: "POLICY_VERSION_REQUIRED" },
    });

    expect(authorizeAppend({ ...baseProductionRequest(), policyVersion: 2 })).toMatchObject({
      granted: false,
      refusal: { code: "POLICY_VERSION_MISMATCH" },
    });
  });

  it("requires strong transaction evidence for the Production Family Alpha write", () => {
    expect(authorizeAppend({
      ...baseProductionRequest(),
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "James said the transaction happened",
    })).toMatchObject({
      granted: false,
      refusal: { code: "INSUFFICIENT_EVIDENCE" },
    });
  });

  it("passes only when policy identity, version, human approval, transaction evidence and credential are all present", () => {
    const result = authorizeAppend(baseProductionRequest());
    expect(result).toMatchObject({
      granted: true,
      target: "PRODUCTION_WRITE",
      writerMode: "PRODUCTION_WRITE",
    });
    if (!result.granted) return;
    expect(result.authorization.policyIdentity).toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID);
    expect(result.authorization.policyVersion).toBe(FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION);
    expect(result.authorization.evidenceSource).toBe("STRONG_TRANSACTION_EVIDENCE");
  });
});
