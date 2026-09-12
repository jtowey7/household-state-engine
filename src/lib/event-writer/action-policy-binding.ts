import type { AppendAuthorization } from "./types";

export type CanonicalActionPolicy = {
  action: string;
  authority: string;
  status: string;
  policyIdentity: string;
  policyVersion: number;
  evidenceFreshnessContract: string;
};

/**
 * Production household writes must be bound to a canonical ACTION POLICY row,
 * not merely carry an arbitrary actionPolicyReference supplied by the caller.
 */
export function assertCanonicalProductionWritePolicy(
  policy: CanonicalActionPolicy,
  authorization: AppendAuthorization,
): void {
  const expectedIdentity = authorization.policyIdentity?.trim();
  if (!expectedIdentity) throw new Error("Production write policy identity is required");

  const expectedVersion = authorization.policyVersion;
  if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    throw new Error("Production write policy version is required");
  }

  if (!policy.action.trim() || policy.action !== authorization.actionPolicyReference) {
    throw new Error("Production write policy action mismatch");
  }

  if (policy.policyIdentity !== expectedIdentity) {
    throw new Error("Production write policy identity mismatch");
  }

  if (policy.policyVersion !== authorization.policyVersion) {
    throw new Error("Production write policy version mismatch");
  }

  if (policy.authority !== "Approve") {
    throw new Error(`Production write policy authority is ${policy.authority}, not Approve`);
  }

  if (policy.status !== "Approved") {
    throw new Error(`Production write policy status is ${policy.status}, not Approved`);
  }

  if (!policy.evidenceFreshnessContract.trim()) {
    throw new Error("Production write policy is missing its evidence freshness contract");
  }
}
