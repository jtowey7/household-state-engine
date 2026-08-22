import { describe, expect, it } from "vitest";
import {
  authorizeFamilyAlphaWrite,
  familyAlphaRequestFingerprint,
  FAMILY_ALPHA_OPERATION,
  validateFamilyAlphaReplay,
  type ControlledWriteRequest,
} from "./production-write-boundary";

const baseRequest = (): ControlledWriteRequest => {
  const request = {
    operation: FAMILY_ALPHA_OPERATION,
    releaseId: "release-alpha-001",
    expectedSnapshotId: "snapshot-001",
    expectedReplayId: "replay-001",
    event: {
      eventId: "alpha-event-001",
      recordClass: "Production" as const,
      eventType: "ITEM_STOCK_DELTA" as const,
      itemKey: "milk",
      occurredAt: "2026-08-22T08:00:00.000Z",
      payload: { quantity: -1, unit: "litre", note: "Family Alpha controlled write" },
    },
    compensation: {
      eventId: "alpha-comp-001",
      recordClass: "Production" as const,
      eventType: "ITEM_STOCK_DELTA" as const,
      itemKey: "milk",
      occurredAt: "2026-08-22T08:00:01.000Z",
      payload: { quantity: 1, unit: "litre", note: "Manual compensation for alpha-event-001" },
      compensatesEventId: "alpha-event-001",
    },
  };

  return {
    ...request,
    approval: {
      approvalId: "approval-001",
      approvedBy: "James",
      approvedAt: "2026-08-22T08:00:02.000Z",
      expiresAt: "2026-08-22T08:15:02.000Z",
      operation: FAMILY_ALPHA_OPERATION,
      expectedSnapshotId: "snapshot-001",
      expectedReplayId: "replay-001",
      releaseId: "release-alpha-001",
      requestFingerprint: familyAlphaRequestFingerprint(request),
    },
  };
};

function refreshFingerprint(request: ControlledWriteRequest): void {
  const { approval, ...fingerprintInput } = request;
  request.approval.requestFingerprint = familyAlphaRequestFingerprint(fingerprintInput);
}

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

  it("refuses write-payload drift even when snapshot and replay IDs are unchanged", () => {
    const request = baseRequest();
    request.event.payload.quantity = -2;
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "APPROVAL_FINGERPRINT_MISMATCH",
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
    refreshFingerprint(request);
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_EVENT_ID",
    });
  });

  it("refuses a compensation event that is not bound to the forward event", () => {
    const request = baseRequest();
    request.compensation.compensatesEventId = "other-event";
    refreshFingerprint(request);
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_COMPENSATION",
    });
  });

  it("refuses a compensation event that is not the exact inverse quantity", () => {
    const request = baseRequest();
    request.compensation.payload.quantity = -1;
    refreshFingerprint(request);
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_COMPENSATION",
    });
  });

  it("refuses non-delta event types by construction of the Alpha write contract", () => {
    const request = baseRequest();
    (request.event as unknown as { eventType: string }).eventType = "ITEM_STOCK_SET";
    refreshFingerprint(request);
    expect(authorizeFamilyAlphaWrite(request, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "INVALID_COMPENSATION",
    });
  });

  it("refuses a changed payload under the same release ID", () => {
    const first = baseRequest();
    const replay = structuredClone(first);
    replay.event.payload.quantity = -2;
    expect(validateFamilyAlphaReplay(first, replay, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: false,
      code: "PAYLOAD_CONFLICT",
    });
  });

  it("treats an identical release replay as idempotent with zero additional mutations", () => {
    const first = baseRequest();
    const replay = structuredClone(first);
    expect(validateFamilyAlphaReplay(first, replay, "2026-08-22T08:05:00.000Z")).toMatchObject({
      ok: true,
      mutationCount: 0,
      externalIOMode: "NONE",
    });
  });

  it("refuses an expired approval when a new release is replayed", () => {
    const first = baseRequest();
    const replay = structuredClone(first);
    replay.releaseId = "release-alpha-002";
    replay.approval.releaseId = "release-alpha-002";
    replay.approval.expiresAt = "2026-08-22T08:15:02.000Z";
    refreshFingerprint(replay);

    expect(validateFamilyAlphaReplay(first, replay, "2026-08-22T08:16:00.000Z")).toMatchObject({
      ok: false,
      code: "APPROVAL_EXPIRED",
    });
  });
});
