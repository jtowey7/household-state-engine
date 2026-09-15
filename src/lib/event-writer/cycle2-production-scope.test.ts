import { describe, expect, it } from "vitest";

import { canonicaliseAppend, createHouseholdEventWriter } from "./index";
import type { AppendAuthorization, CanonicalAppendRecord } from "./types";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-09-15T12:00:00.000Z";

function canonical(): CanonicalAppendRecord {
  const intent: AppendIntent = {
    eventType: "Consumption",
    item: "Mince",
    occurredAt: "2026-09-15T11:00:00.000Z",
    quantityDelta: -500,
    unit: "g",
    source: "FoodOS household inventory",
    actor: "household operator",
    entityType: "Inventory item",
    entityReference: "INV-MINCE-1",
    evidence: "Household operator explicitly reported the amount now remaining",
    confidence: "High",
    stateBefore: 1000,
    recordClass: "Production",
  };
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture failed: ${result.rejection.code}`);
  return result.record;
}

function authorizationFor(record: CanonicalAppendRecord, overrides: Partial<AppendAuthorization> = {}): AppendAuthorization {
  return {
    authorizationId: "AUTH-CYCLE2",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: now(),
    evidenceSource: "STRONG_TRANSACTION_EVIDENCE",
    evidenceDetail: "Verified transaction evidence.",
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: "Record Family Alpha household event",
    policyIdentity: "family-alpha-household-event:v1",
    policyVersion: 1,
    ...overrides,
  };
}

describe("Cycle 2 routine Production inventory scope", () => {
  it("refuses a routine stock action even when it borrows the Family Alpha policy identity", async () => {
    const appended: CanonicalAppendRecord[] = [];
    const writer = createHouseholdEventWriter({
      mode: "PRODUCTION_WRITE",
      port: {
        portId: "production-test-double",
        provenance: "PRODUCTION",
        append: async (record) => {
          appended.push(record);
          return { connectorRecordId: "must-not-write" };
        },
      },
    });

    const record = canonical();
    const receipt = await writer.append(record, authorizationFor(record, {
      actionPolicyReference: "Record a routine consumption event",
    }));

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(appended).toHaveLength(0);
  });

  it("requires strong transaction evidence for the Family Alpha Production scope", async () => {
    const appended: CanonicalAppendRecord[] = [];
    const writer = createHouseholdEventWriter({
      mode: "PRODUCTION_WRITE",
      port: {
        portId: "production-test-double",
        provenance: "PRODUCTION",
        append: async (record) => {
          appended.push(record);
          return { connectorRecordId: "must-not-write" };
        },
      },
    });

    const record = canonical();
    const receipt = await writer.append(record, authorizationFor(record, {
      evidenceSource: "EXPLICIT_USER_INPUT",
    }));

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(appended).toHaveLength(0);
  });
});
