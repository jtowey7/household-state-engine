import { describe, expect, it } from "vitest";
import { assertCanonicalProductionWritePolicy } from "./action-policy-binding";
import type { AppendAuthorization } from "./types";

const authorization: AppendAuthorization = {
  authorizationId: "auth-1",
  decision: "APPROVED",
  approvedBy: "James",
  approvedAt: "2026-08-26T08:00:00.000Z",
  evidenceSource: "STRONG_TRANSACTION_EVIDENCE",
  evidenceDetail: "Verified supermarket transaction",
  eventId: "event-1",
  payloadHash: "hash-1",
  actionPolicyReference: "Record Family Alpha household event",
  policyIdentity: "family-alpha-household-event:v1",
  policyVersion: 1,
};

const approvedPolicy = {
  action: "Record Family Alpha household event",
  authority: "Approve",
  status: "Approved",
  policyIdentity: "family-alpha-household-event:v1",
  policyVersion: 1,
  evidenceFreshnessContract: "Fresh transaction evidence required at write time",
};

describe("canonical Production write policy binding", () => {
  it("accepts an exact approved canonical policy", () => {
    expect(() => assertCanonicalProductionWritePolicy(approvedPolicy, authorization)).not.toThrow();
  });

  it("refuses a policy with the wrong identity or version", () => {
    expect(() =>
      assertCanonicalProductionWritePolicy(
        { ...approvedPolicy, policyIdentity: "other:v1" },
        authorization,
      ),
    ).toThrow(/identity mismatch/);

    expect(() =>
      assertCanonicalProductionWritePolicy(
        { ...approvedPolicy, policyVersion: 2 },
        authorization,
      ),
    ).toThrow(/version mismatch/);
  });

  it("refuses policies that do not grant approved Production authority", () => {
    expect(() =>
      assertCanonicalProductionWritePolicy(
        { ...approvedPolicy, authority: "Prepare" },
        authorization,
      ),
    ).toThrow(/authority is Prepare/);

    expect(() =>
      assertCanonicalProductionWritePolicy(
        { ...approvedPolicy, status: "Design" },
        authorization,
      ),
    ).toThrow(/status is Design/);
  });

  it("refuses missing policy metadata", () => {
    expect(() =>
      assertCanonicalProductionWritePolicy(
        { ...approvedPolicy, evidenceFreshnessContract: "" },
        authorization,
      ),
    ).toThrow(/freshness contract/);
  });
});
