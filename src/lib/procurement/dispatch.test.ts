import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import { hashOf } from "../state-engine/hash";
import {
  approveBasket,
  basketApprovalFingerprint,
  createBasketApproval,
} from "./approval";
import {
  createDispatchIntent,
  SUBMIT_GROCERY_ORDER_POLICY_ID,
  SUBMIT_GROCERY_ORDER_POLICY_VERSION,
  type DispatchEvidence,
} from "./dispatch";

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

const evidence = (candidate: ReturnType<typeof basket>): DispatchEvidence => ({
  policyIdentity: SUBMIT_GROCERY_ORDER_POLICY_ID,
  policyVersion: SUBMIT_GROCERY_ORDER_POLICY_VERSION,
  basketFingerprint: basketApprovalFingerprint(candidate),
  deliverySlot: {
    slotId: "SLOT-001",
    retailer: "synthetic-grocer",
    startsAt: "2026-08-16T18:00:00.000Z",
    endsAt: "2026-08-16T19:00:00.000Z",
    recordedAt: "2026-08-14T02:05:00.000Z",
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
      evidence(candidate),
    );

    expect(intent.status).toBe("READY");
    expect(intent.requiresExternalDispatch).toBe(true);
    expect(intent.basketId).toBe(candidate.basketId);
    expect(intent.basketVersion).toBe(approved.basketVersion);
    expect(intent.basketFingerprint).toBe(approved.basketFingerprint);
    expect(intent.policyIdentity).toBe(SUBMIT_GROCERY_ORDER_POLICY_ID);
    expect(intent.policyVersion).toBe(SUBMIT_GROCERY_ORDER_POLICY_VERSION);
    expect(intent.evidence.deliverySlot.slotId).toBe("SLOT-001");
    expect(intent.evidence.substitutions.outcome).toBe("NONE");
    expect(intent.expiresAt).toBe("2026-08-14T02:21:00.000Z");
    expect(intent.dispatchId).toBe(
      createDispatchIntent(
        approved,
        candidate,
        "2026-08-15T02:06:00.000Z",
        evidence(candidate),
      ).dispatchId,
    );
  });

  it("refuses evidence bound to the wrong policy identity or version", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        policyIdentity: "submit-grocery-order:legacy" as typeof SUBMIT_GROCERY_ORDER_POLICY_ID,
      }),
    ).toThrow("POLICY_ID_MISMATCH");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        policyVersion: 2 as typeof SUBMIT_GROCERY_ORDER_POLICY_VERSION,
      }),
    ).toThrow("POLICY_VERSION_MISMATCH");
  });

  it("refuses materially stale evidence captured before human approval", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const stale = evidence(candidate);
    stale.deliverySlot.recordedAt = "2026-08-14T02:04:59.000Z";

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", stale),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_STALE");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        substitutions: { ...evidence(candidate).substitutions, recordedAt: "2026-08-14T02:04:59.000Z" },
      }),
    ).toThrow("SUBSTITUTION_EVIDENCE_STALE");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        spendPolicy: { ...evidence(candidate).spendPolicy, recordedAt: "2026-08-14T02:04:59.000Z" },
      }),
    ).toThrow("SPEND_POLICY_EVIDENCE_STALE");
  });

  it("refuses future-dated delivery-slot, substitution and spend-policy evidence", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const future = "2026-08-14T02:07:00.000Z";

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        deliverySlot: { ...evidence(candidate).deliverySlot, recordedAt: future },
      }),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_FUTURE");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        substitutions: { ...evidence(candidate).substitutions, recordedAt: future },
      }),
    ).toThrow("SUBSTITUTION_EVIDENCE_FUTURE");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        spendPolicy: { ...evidence(candidate).spendPolicy, recordedAt: future },
      }),
    ).toThrow("SPEND_POLICY_EVIDENCE_FUTURE");
  });

  it("refuses an already-expired delivery slot at intent creation", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const expiredSlot = {
      ...evidence(candidate),
      deliverySlot: {
        ...evidence(candidate).deliverySlot,
        startsAt: "2026-08-14T00:00:00.000Z",
        endsAt: "2026-08-14T01:00:00.000Z",
      },
    };

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", expiredSlot),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_EXPIRED");
  });

  it("refuses an unapproved basket", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() =>
      createDispatchIntent(pending, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate)),
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
      createDispatchIntent(approved, changed, "2026-08-14T02:06:00.000Z", evidence(changed)),
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
      createDispatchIntent(forged, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate)),
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
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", evidence(candidate)),
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
      createDispatchIntent(approved, candidate, "not-a-timestamp", evidence(candidate)),
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
      createDispatchIntent(noRetailerApproval, noRetailer, "2026-08-14T02:06:00.000Z", evidence(noRetailer)),
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
        ...evidence(candidate),
        deliverySlot: { ...evidence(candidate).deliverySlot, slotId: "" },
      }),
    ).toThrow("DELIVERY_SLOT_EVIDENCE_REQUIRED");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        substitutions: { ...evidence(candidate).substitutions, decisionId: "" },
      }),
    ).toThrow("SUBSTITUTION_EVIDENCE_REQUIRED");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        spendPolicy: { ...evidence(candidate).spendPolicy, decisionId: "" },
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
        ...evidence(candidate),
        deliverySlot: { ...evidence(candidate).deliverySlot, retailer: "other-grocer" },
      }),
    ).toThrow("DELIVERY_SLOT_RETAILER_MISMATCH");

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", {
        ...evidence(candidate),
        spendPolicy: { ...evidence(candidate).spendPolicy, totalCost: candidate.totalCost + 1 },
      }),
    ).toThrow("SPEND_TOTAL_MISMATCH");
  });

  it("refuses dispatch when the spend policy requires separate approval", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );
    const separateApproval = {
      ...evidence(candidate),
      spendPolicy: {
        ...evidence(candidate).spendPolicy,
        outcome: "SEPARATE_APPROVAL_REQUIRED" as const,
      },
    };

    expect(() =>
      createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z", separateApproval),
    ).toThrow("SPEND_APPROVAL_REQUIRED");
  });
});
