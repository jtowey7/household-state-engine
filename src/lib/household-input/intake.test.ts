import { describe, expect, it } from "vitest";
import { createAirtableAppendPort } from "../event-writer/ports";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import type { HouseholdIntakeSubmission } from "./types";
import { canonicalRecordToHouseholdEvent } from "../state-engine/canonical-household-event-replay";
import { replayEvents } from "../state-engine/engine";

const deliveryInput: HouseholdIntakeSubmission = {
  kind: "DELIVERY",
  input: {
    basketId: "basket-alpha-v1",
    orderReference: "ORDER-ALPHA-001",
    retailer: "Tesco",
    capturedAt: "2026-09-03T09:00:00.000Z",
    capturedBy: "James",
    delivery: {
      deliveryId: "delivery-alpha-001",
      dispatchId: "dispatch-alpha-001",
      basketId: "basket-alpha-v1",
      basketVersion: 1,
      basketFingerprint: "basket-fingerprint-alpha",
      deliveredAt: "2026-09-03T08:00:00.000Z",
      reconciliationStatus: "RECONCILED",
      lines: [
        { lineId: "line-1", itemKey: "Tesco Chicken Breast", deliveredQuantity: 2, unit: "pack" },
      ],
    },
  },
};

function now() {
  return "2026-09-03T09:01:00.000Z";
}

describe("household intake approval boundary", () => {
  it("prepares delivery input without mutation and exposes exact approval requests", () => {
    const prepared = prepareHouseholdIntake(deliveryInput, { now });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.productionMutation).toBe(false);
    expect(prepared.requiresHumanAuthorization).toBe(true);
    expect(prepared.proposed).toBe(1);
    expect(prepared.approvalRequests).toHaveLength(1);
    expect(prepared.approvalRequests[0]!.eventId).toBe(prepared.records[0]!.eventId);
    expect(prepared.approvalRequests[0]!.payloadHash).toBe(prepared.records[0]!.payloadHash);
    expect(prepared.receipts[0]!.outcome).toBe("PROPOSED");
  });

  it("requires an exact Event ID and payload hash before the protected writer appends", async () => {
    const first = prepareHouseholdIntake(deliveryInput, { now });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const portCalls: string[] = [];
    const portResult = createAirtableAppendPort({
      baseId: "appmqDptH3taN8uby",
      credential: "test-only-credential",
      transport: async (record) => {
        portCalls.push(record.eventId);
        return {
          connectorRecordId: `test-${portCalls.length}`,
          acknowledgedAt: record.row["Recorded at"],
        };
      },
    });
    expect(portResult.ok).toBe(true);
    if (!portResult.ok) return;

    const wrongHash = {
      ...first.approvalRequests[0]!,
      payloadHash: "tampered-payload-hash",
    };
    const rejected = await releaseHouseholdIntake({
      submission: deliveryInput,
      writer: createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: portResult.port }),
      approvals: [
        authorizationFromRequest(wrongHash, {
          authorizationId: "AUTH-WRONG-HASH",
          approvedBy: "James",
          approvedAt: "2026-09-03T09:02:00.000Z",
          evidenceDetail: "Explicit test approval with intentionally mismatched payload hash.",
        }),
      ],
      now,
    });

    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.appended).toBe(0);
    expect(rejected.rejected).toBe(1);
    expect(rejected.receipts[0]!.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(portCalls).toHaveLength(0);

    const exact = authorizationFromRequest(first.approvalRequests[0]!, {
      authorizationId: "AUTH-EXACT",
      approvedBy: "James",
      approvedAt: "2026-09-03T09:03:00.000Z",
      evidenceDetail: "Explicit test approval bound to the exact canonical Event ID and payload hash.",
    });
    const accepted = await releaseHouseholdIntake({
      submission: deliveryInput,
      writer: createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: portResult.port }),
      approvals: [exact],
      now,
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.appended).toBe(1);
    expect(accepted.rejected).toBe(0);
    expect(accepted.written).toBe(true);
    expect(portCalls).toHaveLength(1);
  });

  it("carries an explicit used-stock action from canonical proposal into deterministic inventory replay", () => {
    const usedInput: HouseholdIntakeSubmission = {
      kind: "STOCK_CORRECTION",
      report: {
        exceptionId: "EXC-MINCE-USED-001",
        itemKey: "mince-beef",
        statedStateAfter: 0,
        unit: "pack",
        observedAt: "2026-09-15T01:00:00.000Z",
        reportedBy: "James",
        source: "FoodOS /food",
        evidence: "Used the last pack for dinner.",
        confidence: "High",
        reason: "Explicit household action: used",
        recordClass: "Production",
      },
    };

    const prepared = prepareHouseholdIntake(usedInput, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.records).toHaveLength(1);
    expect(prepared.records[0]!.row["Event type"]).toBe("Correction");
    expect(prepared.records[0]!.row["Record class"]).toBe("Production");
    expect(prepared.records[0]!.row.Item).toBe("mince-beef");
    expect(prepared.records[0]!.row["State after"]).toBe("0");
    expect(prepared.productionMutation).toBe(false);

    const mapped = canonicalRecordToHouseholdEvent(prepared.records[0]!);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const snapshot = replayEvents([mapped.event], { now });
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        itemKey: "mince-beef",
        quantity: 0,
        unit: "pack",
        contributingEventIds: [prepared.records[0]!.eventId],
        blocked: false,
      }),
    ]);
  });
});
