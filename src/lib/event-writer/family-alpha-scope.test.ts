import { describe, expect, it } from "vitest";

import { canonicaliseAppend, createFakeAppendPort, createHouseholdEventWriter } from "./index";
import type { AppendAuthorization, CanonicalAppendRecord } from "./types";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-09-13T22:00:00.000Z";

function canonical(): CanonicalAppendRecord {
  const intent: AppendIntent = {
    eventType: "Consumption",
    item: "Mince",
    occurredAt: "2026-09-13T18:00:00.000Z",
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

function authorizationFor(
  record: CanonicalAppendRecord,
  overrides: Partial<AppendAuthorization> = {},
): AppendAuthorization {
  return {
    authorizationId: "AUTH-TEST",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: now(),
    evidenceSource: "EXPLICIT_USER_INPUT",
    evidenceDetail: "James explicitly approved this test authorization.",
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: "Record Family Alpha household event",
    policyIdentity: "family-alpha-household-event:v1",
    policyVersion: 1,
    ...overrides,
  };
}

describe("Family Alpha Production action scope", () => {
  it("refuses a routine stock correction that borrows the Family Alpha policy", async () => {
    const port = createFakeAppendPort({ portId: "production-test-double" });
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: {
      ...port,
      provenance: "PRODUCTION",
    } as never });
    const record = canonical();

    const receipt = await writer.append(record, authorizationFor(record));

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("refuses Family Alpha Production approval when evidence is only explicit user input", async () => {
    const appended: CanonicalAppendRecord[] = [];
    const port = {
      portId: "production-test-double",
      provenance: "PRODUCTION" as const,
      append: async (record: CanonicalAppendRecord) => {
        appended.push(record);
        return { connectorRecordId: "must-not-write" };
      },
    };
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const record = canonical();

    const receipt = await writer.append(record, authorizationFor(record));

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(appended).toHaveLength(0);
  });

  it("still permits the exact Family Alpha scope with strong transaction evidence", async () => {
    const appended: CanonicalAppendRecord[] = [];
    const port = {
      portId: "production-test-double",
      provenance: "PRODUCTION" as const,
      append: async (record: CanonicalAppendRecord) => {
        appended.push(record);
        return { connectorRecordId: "test-rec-1" };
      },
    };
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const record = canonical();

    const receipt = await writer.append(
      record,
      authorizationFor(record, { evidenceSource: "STRONG_TRANSACTION_EVIDENCE", evidenceDetail: "Verified Family Alpha transaction." }),
    );

    expect(receipt.outcome).toBe("APPENDED_PRODUCTION");
    expect(receipt.written).toBe(true);
    expect(appended).toHaveLength(1);
  });
});
