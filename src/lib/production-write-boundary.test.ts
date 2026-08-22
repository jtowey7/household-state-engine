import { describe, expect, it } from "vitest";
import {
  authorizeFamilyAlphaWrite,
  FAMILY_ALPHA_OPERATION,
  validateFamilyAlphaReplay,
  type ControlledWriteRequest,
} from "./production-write-boundary";

const baseRequest = (): ControlledWriteRequest => ({
  operation: FAMILY_ALPHA_OPERATION,
  releaseId: "release-alpha-001",
  expectedSnapshotId: "snapshot-001",
  expectedReplayId: "replay-001",
  event: {
    eventId: "alpha-event-001",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "milk",
    occurredAt: "2026-08-22T08:00:00.000Z",
    payload: { quantity: -1, unit: "litre", note: "Family Alpha controlled write" },
  },
  compensation: {
    eventId: "alpha-comp-001",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "milk",
    occurredAt: "2026-08-22T08:00:01.000Z",
    payload: { quantity: 1, unit: "litre", note: "Manual compensation for alpha-event-001" },
    compensatesEventId: "alpha-event-001",
  },
  approval: {
    approvalId: "approval-001",
    approvedBy: "James",
    approvedAt: "2026-08-22T08:00:02.000Z",
    expiresAt: "2026-08-22T08:15:02.000Z",
    operation: FAMILY_ALPHA_OPERATION,
    expectedSnapshotId: "snapshot-001",
    expectedReplayId: "replay-001",
    releaseId: "release-alpha-001",
  },
});

describe("Family Alpha controlled Production write boundary", () => {
  it("accepts exactly one approved write plan without performing I/O", () => {
    const result = authorizeFamilyAlphaWrite(baseRequest(), "2026-08-22T08:05:00.000Z");
    expect(result).toMatchObject({ ok: true, mutationCount: 1, externalIOMode: "NONE" });
  });

  it("refuses an approval from an automated principal", () => {
    const request = baseRequest();
    request.approval.approvedBy = "scheduler-agent";
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "AUTOMATED_APPROVAL_REJECTED",
    });
  });

  it("refuses snapshot drift after human approval", () => {
    const request = baseRequest();
    request.expectedSnapshotId = "snapshot-new";
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "APPROVAL_SNAPSHOT_MISMATCH",
    });
  });

  it("refuses expired approval", () => {
    expect(authorizeFamilyAlphaWrite(baseRequest(), "2026-08-22T08:15:02.000Z")).toMatchObject({
      ok: false,
      code: "APPROVAL_EXPIRED",
    });
  });

  it("refuses an Airtable record id masquerading as Event ID", () => {
    const request = baseRequest();
    request.event.eventId = "rec123456789";
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_EVENT_ID",
    });
  });

  it("refuses a compensation event that is not bound to the forward event", () => {
    const request = baseRequest();
    request.compensation.compensatesEventId = "other-event";
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_COMPENSATION",
    });
  });

  it("refuses a changed payload under the same release ID", () => {
    const first = baseRequest();
    const replay = structuredClone(first);
    replay.event.payload.quantity = -2;
    expect(validateFamilyAlphaReplay(first, replay)).toMatchObject({
      ok: false,
      code: "PAYLOAD_CONFLICT",
    });
  });

  it("treats an identical release replay as idempotent", () => {
    const first = baseRequest();
    const replay = structuredClone(first);
    expect(validateFamilyAlphaReplay(first, replay)).toMatchObject({
      ok: true,
      mutationCount: 1,
      externalIOMode: "NONE",
    });
  });
});
