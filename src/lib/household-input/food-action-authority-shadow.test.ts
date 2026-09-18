import { describe, expect, it } from "vitest";

import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import { createHouseholdEventWriter } from "../event-writer/writer";
import type { ProductionEventAppendPort } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";

const now = () => "2026-09-14T17:00:00.000Z";

function stockAction(action: "USED" | "WASTED" | "CHANGED" | "ADDED"): HouseholdIntakeSubmission {
  return {
    kind: "STOCK_CORRECTION",
    report: {
      exceptionId: `EXC-${action}`,
      itemKey: "beef mince",
      statedStateAfter: action === "ADDED" ? 2 : 0,
      unit: "packs",
      observedAt: now(),
      reportedBy: "household operator",
      source: "FoodOS household inventory",
      evidence: `Explicit household ${action.toLowerCase()} action for beef mince.`,
      confidence: "High",
      reason: `Explicit household action: ${action.toLowerCase()}.`,
      recordClass: "Production",
    },
  };
}

describe("/food stock action -> canonical event -> production authority boundary", () => {
  it.each(["USED", "WASTED", "CHANGED", "ADDED"] as const)(
    "%s becomes a canonical proposal but cannot cross the production writer without the governed action policy",
    async (action) => {
      const submission = stockAction(action);
      const prepared = prepareHouseholdIntake(submission, { now });

      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.records).toHaveLength(1);
      expect(prepared.records[0]?.row["Record class"]).toBe("Production");
      expect(prepared.approvalRequests[0]?.requiredEvidenceSource).toBe("EXPLICIT_USER_INPUT");
      expect(prepared.approvalRequests[0]?.policyBinding).toBeUndefined();

      const authorization = authorizationFromRequest(prepared.approvalRequests[0]!, {
        authorizationId: `AUTH-${action}`,
        approvedBy: "household operator",
        approvedAt: now(),
        evidenceDetail: "Explicit household approval of the exact canonical stock action.",
      });

      let connectorCalls = 0;
      const port: ProductionEventAppendPort = {
        portId: "test-production-port",
        provenance: "PRODUCTION",
        async append() {
          connectorCalls += 1;
          return { connectorRecordId: "must-not-be-called", acknowledgedAt: now() };
        },
      };

      const released = await releaseHouseholdIntake({
        submission,
        writer: createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port }),
        approvals: [authorization],
        now,
      });

      expect(released.ok).toBe(true);
      if (!released.ok) return;
      expect(released.appended).toBe(0);
      expect(released.written).toBe(false);
      expect(released.rejected).toBe(1);
      expect(released.receipts[0]?.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
      expect(connectorCalls).toBe(0);
    },
  );
});
