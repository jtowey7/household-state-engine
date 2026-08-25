import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import { basketApprovalFingerprint } from "./approval";
import { validateDispatchEvidence, type DispatchEvidence } from "./dispatch";

const plan: QuantityRunPlan = {
  replayId: "R-DISPATCH-STALE-SLOT",
  snapshotId: "S-DISPATCH-STALE-SLOT",
  replayTimestamp: "2026-08-14T02:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-DISPATCH-STALE-SLOT",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [
    {
      requirementId: "REQ-MILK",
      itemKey: "milk-whole",
      requiredQuantity: 2,
      unit: "L",
      onHandQuantity: 4,
      targetQuantity: 6,
      sourceEventIds: ["EVT-MILK"],
      packSize: 1,
      packCount: 2,
      packRoundedQuantity: 2,
    },
  ],
};

const basket = () =>
  aggregateCandidateBasket(plan, { catalogue: shadowCatalogue, retailer: "synthetic-grocer" });

const evidence = (candidate: ReturnType<typeof basket>): DispatchEvidence => ({
  basketFingerprint: basketApprovalFingerprint(candidate),
  deliverySlot: {
    slotId: "SLOT-STALE",
    retailer: "synthetic-grocer",
    startsAt: "2026-09-01T18:00:00.000Z",
    endsAt: "2026-09-01T19:00:00.000Z",
    recordedAt: "2026-08-01T02:05:00.000Z",
  },
  substitutions: {
    decisionId: "SUB-001",
    outcome: "NONE",
    recordedAt: "2026-08-14T02:05:00.000Z",
  },
  spendPolicy: {
    decisionId: "SPEND-001",
    totalCost: candidate.totalCost,
    outcome: "WITHIN_POLICY",
    recordedAt: "2026-08-14T02:05:00.000Z",
  },
});

describe("Phase 7 stale delivery-slot evidence red-team", () => {
  it("refuses materially stale delivery-slot evidence before external dispatch", () => {
    const candidate = basket();
    const staleEvidence = evidence(candidate);

    expect(() =>
      validateDispatchEvidence(staleEvidence, candidate, "2026-08-14T02:06:00.000Z"),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_STALE");
  });
});
