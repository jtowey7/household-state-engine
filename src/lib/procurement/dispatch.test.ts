import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import { hashOf } from "../state-engine/hash";
import {
  approveBasket,
  basketApprovalFingerprint,
  createBasketApproval,
} from "./approval";
import { createDispatchIntent, type DispatchEvidence } from "./dispatch";

const plan: QuantityRunPlan = {
  replayId: "R-DISPATCH",
  snapshotId: "S-DISPATCH",
  replayTimestamp: "2026-08-14T02:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-DISPATCH",
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

const evidence = (totalCost: number): DispatchEvidence => ({
  deliverySlot: {
    slotId: "SLOT-001",
    retailer: "synthetic-grocer",
    startsAt: "2026-08-14T18:00:00.000Z",
    endsAt: "2026-08-14T19:00:00.000Z",
    recordedAt: "2026-08-14T02:05:00.000Z",
  },
  substitutions: {
    decisionId: "SUB-001",
    outcome: "NONE",
    recordedAt: "2026-08-14T02:05:00.000Z",
  },
  spendPolicy: {
    decisionId: "SPEND-001",
    totalCost,
    outcome: "WITHIN_POLICY",
    recordedAt: "2026-08-14T02:05:00.000Z",
  },
});

describe("approval-bound dispatch gate", () => {
  it("creates a deterministic, time-bounded external dispatch intent only from an approved basket", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    const intent = createDispatchIntent(
      approved,
      candidate,
      "2026-08-14T02:06:00.000Z",
      evidence(candidate.totalCost),
    );

    expect(intent.status).toBe("READY");
    expect(intent.requiresExternalDispatch).toBe(true);
    expect(intent.basketId).toBe(candidate.basketId);
    expect(intent.basketVersion).toBe(approved.basketVersion);
    expect(intent.basketFingerprint).toBe(approved.basketFingerprint);
    expect(intent.evidence.deliverySlot.slotId).toBe("SLOT-001");
    expect(intent.evidence.substitutions.outcome).toBe("NONE");
    expect(intent.expiresAt).toBe("2026-08-14T02:21:00.000Z");
    expect(intent.dispatchId).toBe(
      createDispatchIntent(
        approved,
        candidate,
        "2026-08-15T02:06:00.000Z",
        evidence(candidate.totalCost),
      ).dispatchId,
    );
  });

  it("refuses an unapproved basket", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() =>
      createDispatchIntent(pending, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate.totalCost)),
    ).toThrow("NOT_APPROVED");
  });

  it("refuses a basket changed after approval", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const changed = aggregateCandidateBasket(
      { ...plan, requirements: [{ ...plan.requirements[0]!, requiredQuantity: 3 }] },
      { catalogue: shadowCatalogue, retailer: "synthetic-grocer" },
    );

    expect(() =>
      createDispatchIntent(approved, changed, "2026-08-14T02:06:00.000Z", evidence(changed.totalCost)),
    ).toThrow("BASKET_CHANGED");
  });

  it("refuses an APPROVED record with missing approval provenance", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const forged = { ...approved, approvedBy: null, approvedAt: null };

    expect(() =>
      createDispatchIntent(forged, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate.totalCost)),
    ).toThrow("APPROVAL_PROVENANCE_INVALID");
  });

  it("refuses an approval that post-dates dispatch intent creation", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:07:00.000Z",
      "2026-08-14T02:07:00.000Z",
    );

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate.totalCost)),
    ).toThrow("APPROVAL_TIMESTAMP_FUTURE");
  });

  it("fails closed without a retailer or a valid dispatch timestamp", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    expect(() =>
      createDispatchIntent(approved, candidate, "not-a-timestamp", evidence(candidate.totalCost)),
    ).toThrow("DISPATCH_TIMESTAMP_INVALID");

    const noRetailer = { ...candidate, retailer: null };
    const noRetailerFingerprint = basketApprovalFingerprint(noRetailer);
    const noRetailerApproval = {
      ...approved,
      basketFingerprint: noRetailerFingerprint,
      approvalId: hashOf({
        basketId: approved.basketId,
        basketVersion: approved.basketVersion,
        fingerprint: noRetailerFingerprint,
        approvedAt: approved.approvedAt,
        approvedBy: approved.approvedBy,
      }),
    };

    expect(() =>
      createDispatchIntent(noRetailerApproval, noRetailer, "2026-08-14T02:06:00.000Z", evidence(candidate.totalCost)),
    ).toThrow("RETAILER_REQUIRED");
  });

  it("refuses dispatch without delivery-slot, substitution or spend-policy evidence", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate.totalCost),
        deliverySlot: { ...evidence(candidate.totalCost).deliverySlot, slotId: "" },
      }),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_REQUIRED");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate.totalCost),
        substitutions: { ...evidence(candidate.totalCost).substitutions, decisionId: "" },
      }),
    ).toThrow("SUBSTITUTION_EVIDENCE_REQUIRED");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate.totalCost),
        spendPolicy: { ...evidence(candidate.totalCost).spendPolicy, decisionId: "" },
      }),
    ).toThrow("SPEND_POLICY_EVIDENCE_REQUIRED");
  });

  it("refuses evidence for a different basket total or retailer", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate.totalCost),
        deliverySlot: { ...evidence(candidate.totalCost).deliverySlot, retailer: "other-grocer" },
      }),
    ).toThrow("DELIVERY_SLOT_RETAILER_MISMATCH");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate.totalCost),
        spendPolicy: { ...evidence(candidate.totalCost).spendPolicy, totalCost: candidate.totalCost + 1 },
      }),
    ).toThrow("SPEND_TOTAL_MISMATCH");
  });
});
