import { describe, expect, it } from "vitest";
import {
  appendBaselineBatch,
  batchFingerprintFor,
  canonicaliseAppend,
  createHouseholdEventWriter,
  type BatchAppendAuthorization,
  type CanonicalAppendRecord,
  type ProductionEventAppendPort,
} from "./index";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-08-14T20:00:00.000Z";

function record(item: string, quantityDelta: number): CanonicalAppendRecord {
  const intent: AppendIntent = {
    eventType: "Receipt",
    item,
    occurredAt: "2026-08-14T19:00:00.000Z",
    quantityDelta,
    unit: "g",
    source: "Production INVENTORY baseline test fixture",
    actor: "Food OS baseline test",
    entityType: "Inventory item",
    entityReference: `INV-${item}`,
    evidence: "Current INVENTORY snapshot reviewed and reconciled",
    confidence: "High",
    stateBefore: 0,
    recordClass: "Production",
  };
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture failed: ${result.rejection.code}`);
  return result.record;
}

function auth(records: readonly CanonicalAppendRecord[], overrides: Partial<BatchAppendAuthorization> = {}): BatchAppendAuthorization {
  return {
    authorizationId: "BASELINE-AUTH-2026-08-14",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-08-14T20:10:00.000Z",
    evidenceSource: "EXPLICIT_USER_INPUT",
    evidenceDetail: "Approved one-time initialisation of Production HOUSEHOLD EVENTS from the reviewed current INVENTORY snapshot.",
    actionPolicyReference: "ACTION POLICY recoRPG0IVcUSOl9e",
    policyIdentity: "family-alpha-household-event:v1",
    policyVersion: 1,
    batchFingerprint: batchFingerprintFor(records),
    snapshotId: "BASELINE-SNAPSHOT-2026-08-14",
    eventCount: records.length,
    ...overrides,
  };
}

function productionPort(options: { failOnCall?: number } = {}): ProductionEventAppendPort & { appended: CanonicalAppendRecord[] } {
  const appended: CanonicalAppendRecord[] = [];
  let calls = 0;
  return {
    portId: "production-test-double",
    provenance: "PRODUCTION",
    appended,
    async append(next) {
      calls += 1;
      if (options.failOnCall === calls) throw new Error("simulated connector failure");
      appended.push(next);
      return {
        connectorRecordId: `rec-production-${calls}`,
        acknowledgedAt: now(),
      };
    },
  };
}

const records = [record("oats", 1000), record("rice", 500)];

describe("snapshot-scoped baseline batch authorization", () => {
  it("is deterministic regardless of Airtable pagination/order", () => {
    expect(batchFingerprintFor(records)).toBe(batchFingerprintFor([...records].reverse()));
  });

  it("refuses a changed batch fingerprint before any connector call", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await appendBaselineBatch(writer, records, auth(records, { batchFingerprint: "wrong" }));
    expect(receipt).toHaveLength(1);
    expect(receipt[0]?.rejection?.code).toBe("BATCH_AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("refuses a mismatched event count before any connector call", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await appendBaselineBatch(writer, records, auth(records, { eventCount: 1 }));
    expect(receipt[0]?.rejection?.code).toBe("BATCH_AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("refuses a mixed Test/Production batch before any connector call", async () => {
    const testResult = canonicaliseAppend(
      {
        eventType: "Consumption",
        item: "oats",
        occurredAt: "2026-08-14T19:00:00.000Z",
        quantityDelta: -1,
        unit: "g",
        source: "TEST",
        actor: "Test harness",
        entityType: "Inventory item",
        evidence: "synthetic",
        confidence: "High",
        stateBefore: 1,
        recordClass: "Test",
      },
      { now },
    );
    if (!testResult.ok) throw new Error("test fixture failed");
    const mixed = [records[0]!, testResult.record];
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await appendBaselineBatch(writer, mixed, auth(mixed));
    expect(receipt[0]?.rejection?.code).toBe("TEST_RECORD_REFUSED");
    expect(port.appended).toHaveLength(0);
  });

  it("requires the approved snapshot authority and appends the complete batch", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const receipt = await appendBaselineBatch(writer, records, auth(records));
    expect(receipt.map((r) => r.outcome)).toEqual(["APPENDED_PRODUCTION", "APPENDED_PRODUCTION"]);
    expect(receipt.every((r) => r.written)).toBe(true);
    expect(port.appended).toHaveLength(2);
  });

  it("is resumable: an identical retry produces duplicate no-ops, not second writes", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const approval = auth(records);
    const first = await appendBaselineBatch(writer, records, approval);
    const second = await appendBaselineBatch(writer, records, approval);
    expect(first.map((r) => r.outcome)).toEqual(["APPENDED_PRODUCTION", "APPENDED_PRODUCTION"]);
    expect(second.map((r) => r.outcome)).toEqual(["DUPLICATE_NOOP", "DUPLICATE_NOOP"]);
    expect(port.appended).toHaveLength(2);
  });

  it("recovers from a connector failure without duplicating the already-written prefix", async () => {
    const port = productionPort({ failOnCall: 2 });
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const approval = auth(records);
    const first = await appendBaselineBatch(writer, records, approval);
    expect(first.map((r) => r.outcome)).toEqual(["APPENDED_PRODUCTION", "REJECTED"]);
    expect(first[1]?.rejection?.code).toBe("CONNECTOR_FAILED");
    expect(port.appended).toHaveLength(1);

    const second = await appendBaselineBatch(writer, records, approval);
    expect(second.map((r) => r.outcome)).toEqual(["DUPLICATE_NOOP", "APPENDED_PRODUCTION"]);
    expect(port.appended).toHaveLength(2);
  });

  it("never turns snapshot approval into a reusable single-event approval", async () => {
    const port = productionPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const approval = auth(records);
    const batch = await appendBaselineBatch(writer, records, approval);
    expect(batch).toHaveLength(2);

    const unrelated = record("flour", 100);
    const direct = await writer.append(unrelated, undefined);
    expect(direct.rejection?.code).toBe("AUTHORIZATION_REQUIRED");
    expect(port.appended).toHaveLength(2);
  });
});
