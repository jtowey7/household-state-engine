import { describe, expect, it } from "vitest";

import { canonicaliseAppend, createHouseholdEventWriter } from "./index";
import {
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
  FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
} from "./gate";
import type { AppendAuthorization, CanonicalAppendRecord, ProductionEventAppendPort } from "./types";
import type { AppendIntent } from "../write-boundary/types";

const intent: AppendIntent = {
  eventType: "Consumption",
  item: "SALMON",
  occurredAt: "2026-09-03T18:30:00.000Z",
  quantityDelta: -1,
  unit: "portion",
  source: "Delivery reconciliation",
  actor: "Food OS state engine",
  entityType: "Inventory item",
  entityReference: "INV-SALMON",
  evidence: "Strong transaction evidence confirms delivery reconciliation",
  confidence: "High",
  stateBefore: 1,
  recordClass: "Production",
};

function canonical(): CanonicalAppendRecord {
  const result = canonicaliseAppend(intent, { now: () => "2026-09-04T09:00:00.000Z" });
  if (!result.ok) throw new Error(result.rejection.code);
  return result.record;
}

function authorizationFor(record: CanonicalAppendRecord, overrides: Partial<AppendAuthorization> = {}): AppendAuthorization {
  return {
    authorizationId: "AUTH-POLICY-IMMUTABLE",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-09-04T09:01:00.000Z",
    evidenceSource: "STRONG_TRANSACTION_EVIDENCE",
    evidenceDetail: "Exact Family Alpha transaction evidence approved by the human operator.",
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: "Record Family Alpha household event",
    policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
    policyVersion: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
    ...overrides,
  };
}

function productionPort(calls: string[]): ProductionEventAppendPort {
  return {
    portId: "production-test-port",
    provenance: "PRODUCTION",
    append: async (record) => {
      calls.push(record.eventId);
      return { connectorRecordId: `row-${record.eventId}` };
    },
  };
}

describe("Family Alpha production policy binding", () => {
  it("refuses an approval with no policy identity/version before connector dispatch", async () => {
    const calls: string[] = [];
    const record = canonical();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: productionPort(calls) });

    const approval = authorizationFor(record);
    delete approval.policyIdentity;
    delete approval.policyVersion;

    const receipt = await writer.append(record, approval);

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(calls).toHaveLength(0);
  });

  it("refuses policy drift before connector dispatch", async () => {
    const calls: string[] = [];
    const record = canonical();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: productionPort(calls) });

    const receipt = await writer.append(
      record,
      authorizationFor(record, {
        policyIdentity: "family-alpha-household-event:v0",
        policyVersion: 0,
      }),
    );

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(calls).toHaveLength(0);
  });

  it("accepts only the canonical Family Alpha policy and reaches the production port", async () => {
    const calls: string[] = [];
    const record = canonical();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: productionPort(calls) });

    const receipt = await writer.append(record, authorizationFor(record));

    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(receipt.written).toBe(true);
    expect(calls).toEqual([record.eventId]);
  });

  it("ignores a malicious runtime-only expected-policy override", async () => {
    const calls: string[] = [];
    const record = canonical();
    const writer = createHouseholdEventWriter({
      mode: "PRODUCTION_WRITE",
      expectedPolicyIdentity: "attacker-policy:v9",
      expectedPolicyVersion: 9,
      port: productionPort(calls),
    } as never);

    const receipt = await writer.append(record, authorizationFor(record));

    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(calls).toEqual([record.eventId]);
  });
});
