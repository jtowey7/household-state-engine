import { describe, expect, it } from "vitest";
import type { CanonicalAppendRecord } from "./types";
import {
  PRODUCTION_BASELINE_ACTION,
  authorizeProductionBaselineEvent,
  type ProductionBaselineAuthorization,
} from "./baseline-authorization";

function record(eventId: string, occurredAt = "2026-08-14T21:00:00.000Z"): CanonicalAppendRecord {
  return {
    eventId,
    payloadHash: `hash-${eventId}`,
    __canonical: "HOUSEHOLD_EVENTS",
    row: {
      "Event ID": eventId,
      "Event type": "ITEM_STOCK_SET",
      "Occurred at": occurredAt,
      "Recorded at": occurredAt,
      "Source": "INVENTORY_SNAPSHOT",
      "Actor": "FoodOS",
      "Entity type": "Item",
      "Entity reference": eventId,
      "Item": "pasta",
      "Quantity delta": null,
      "Unit": "g",
      "Evidence": "Current INVENTORY snapshot",
      "State before": null,
      "State after": null,
      "Confidence": "Exact",
      "Supersedes event ID": null,
      "Exception / reconciliation action": null,
      "Replay status": "Pending",
      "Record class": "Production",
    },
  };
}

function approval(eventIds: readonly string[]): ProductionBaselineAuthorization {
  return {
    authorizationId: "BASELINE-AUTH-1",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-08-14T21:05:00.000Z",
    actionPolicyReference: PRODUCTION_BASELINE_ACTION,
    baselineId: "baseline-123",
    baselineTimestamp: "2026-08-14T21:00:00.000Z",
    source: "INVENTORY_SNAPSHOT",
    sourceRecordCount: 228,
    eventIds,
    scope: "INITIAL_PRODUCTION_INVENTORY_BASELINE",
  };
}

describe("Production baseline batch authorization", () => {
  it("expands one exact snapshot approval into an event-scoped append authorization", () => {
    const result = authorizeProductionBaselineEvent(record("event-1"), approval(["event-1"]));

    expect(result.granted).toBe(true);
    if (!result.granted) return;
    expect(result.authorization.eventId).toBe("event-1");
    expect(result.authorization.payloadHash).toBe("hash-event-1");
    expect(result.authorization.authorizationId).toBe("BASELINE-AUTH-1:event-1");
    expect(result.authorization.evidenceSource).toBe("EXPLICIT_USER_INPUT");
  });

  it("refuses an Event ID outside the approved manifest", () => {
    const result = authorizeProductionBaselineEvent(record("event-2"), approval(["event-1"]));
    expect(result).toEqual({
      granted: false,
      refusal: {
        code: "BASELINE_EVENT_NOT_IN_MANIFEST",
        detail: "This Event ID is not part of the exact approved baseline manifest.",
      },
    });
  });

  it("refuses a changed baseline timestamp", () => {
    const result = authorizeProductionBaselineEvent(
      record("event-1", "2026-08-14T21:01:00.000Z"),
      approval(["event-1"]),
    );
    expect(result.granted).toBe(false);
    if (result.granted) return;
    expect(result.refusal.code).toBe("BASELINE_SCOPE_MISMATCH");
  });

  it("refuses Test-class records even when the Event ID is listed", () => {
    const testRecord = {
      ...record("event-1"),
      row: { ...record("event-1").row, "Record class": "Test" },
    } as CanonicalAppendRecord;
    const result = authorizeProductionBaselineEvent(testRecord, approval(["event-1"]));
    expect(result.granted).toBe(false);
    if (result.granted) return;
    expect(result.refusal.code).toBe("BASELINE_SCOPE_MISMATCH");
  });

  it("fails closed without approval", () => {
    const result = authorizeProductionBaselineEvent(record("event-1"), null);
    expect(result).toEqual({
      granted: false,
      refusal: {
        code: "BASELINE_AUTHORIZATION_REQUIRED",
        detail: "The one-time Production baseline requires an explicit snapshot-scoped approval.",
      },
    });
  });
});
