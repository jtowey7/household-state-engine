import { describe, expect, it } from "vitest";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import { canonicalRecordToHouseholdEvent } from "../state-engine/canonical-household-event-replay";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import type { ProductionEventAppendPort } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";

const stockCorrection: HouseholdIntakeSubmission = {
  kind: "STOCK_CORRECTION",
  report: {
    exceptionId: "EXC-ALPHA-001",
    itemKey: "milk-whole",
    observedQuantity: 2,
    unit: "L",
    observedAt: "2026-09-04T02:00:00.000Z",
    reason: "EXPLICIT HOUSEHOLD STOCK INPUT",
    reportedBy: "James",
  },
};

const now = () => "2026-09-04T02:01:00.000Z";

describe("approved household intake -> replay -> quantity proof", () => {
  it("carries an explicitly approved canonical stock event into inventory and quantity requirements", async () => {
    const prepared = prepareHouseholdIntake(stockCorrection, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const captured: typeof prepared.records = [];
    const port: ProductionEventAppendPort = {
      portId: "test-approved-intake-port",
      provenance: "PRODUCTION",
      async append(record) {
        captured.push(record);
        return {
          connectorRecordId: "test-row-1",
          acknowledgedAt: now(),
        };
      },
    };

    const approval = authorizationFromRequest(prepared.approvalRequests[0]!, {
      authorizationId: "AUTH-ALPHA-001",
      approvedBy: "James",
      approvedAt: "2026-09-04T02:02:00.000Z",
      evidenceDetail: "Explicit household stock observation approved for the exact canonical event.",
    });

    const released = await releaseHouseholdIntake({
      submission: stockCorrection,
      writer: createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port }),
      approvals: [approval],
      now,
    });

    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.appended).toBe(1);
    expect(released.rejected).toBe(0);
    expect(captured).toHaveLength(1);

    const mapped = canonicalRecordToHouseholdEvent(captured[0]!);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const snapshot = replayEvents([mapped.event], { now });
    const handoff = toQuantityRequirementsHandoff(snapshot);
    const quantity = adaptSnapshotToQuantityRun(handoff, {
      targets: [{ itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" }],
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({
        itemKey: "milk-whole",
        quantity: 2,
        unit: "L",
        contributingEventIds: [captured[0]!.eventId],
      }),
    ]);
    expect(quantity.eligibleForProcurement).toBe(true);
    expect(quantity.requirements).toEqual([
      expect.objectContaining({
        itemKey: "milk-whole",
        requiredQuantity: 4,
        unit: "L",
        onHandQuantity: 2,
        targetQuantity: 6,
        packSize: 1,
        packCount: 4,
        sourceEventIds: [captured[0]!.eventId],
      }),
    ]);
  });
});
