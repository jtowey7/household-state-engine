import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket } from "./adapter";
import { approveBasket, createBasketApproval, validateBasketApproval } from "./approval";
import { createDispatchIntent } from "./dispatch";
import { shadowCatalogue } from "./fixtures";
import type { QuantityRunPlan } from "../quantity-adapter/types";

const NOW = "2026-08-22T00:30:00.000Z";
const APPROVED_AT = "2026-08-22T00:25:00.000Z";
const INTENT_AT = "2026-08-22T00:26:00.000Z";

function plan(): QuantityRunPlan {
  return {
    replayId: "REPLAY-PHASE6",
    snapshotId: "SNAPSHOT-PHASE6",
    replayTimestamp: "2026-08-22T00:00:00.000Z",
    reconciliationStatus: "RECONCILED",
    planId: "PLAN-PHASE6",
    eligibleForProcurement: true,
    executed: true,
    requirements: [
      {
        requirementId: "REQ-OATS",
        itemKey: "oats-rolled",
        requiredQuantity: 750,
        unit: "g",
        onHandQuantity: 0,
        targetQuantity: 750,
        sourceEventIds: ["EVENT-OATS"],
        packSize: 500,
        packCount: 2,
        packRoundedQuantity: 1000,
      },
      {
        requirementId: "REQ-EGGS",
        itemKey: "eggs-large",
        requiredQuantity: 6,
        unit: "count",
        onHandQuantity: 0,
        targetQuantity: 6,
        sourceEventIds: ["EVENT-EGGS"],
        packSize: 6,
        packCount: 1,
        packRoundedQuantity: 6,
      },
    ],
    rejections: [],
    blockedItemKeys: [],
  };
}

function basket() {
  return aggregateCandidateBasket(plan(), {
    catalogue: shadowCatalogue,
    retailer: "synthetic-grocer",
  });
}

describe("Basket Phase 6 approval boundary acceptance", () => {
  it("keeps dispatch intent creation fail-closed until a human approval exists", () => {
    const candidate = basket();
    const approval = createBasketApproval(candidate);

    expect(() => createDispatchIntent(approval, candidate, INTENT_AT)).toThrow(
      "Cannot create dispatch intent: NOT_APPROVED",
    );
  });

  it("creates a bounded dispatch intent only from a valid, versioned human approval", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approved = approveBasket(pending, candidate, "James", APPROVED_AT, NOW);

    expect(validateBasketApproval(approved, candidate, NOW)).toEqual({ valid: true });

    const intent = createDispatchIntent(approved, candidate, INTENT_AT);
    expect(intent.status).toBe("READY");
    expect(intent.requiresExternalDispatch).toBe(true);
    expect(intent.basketId).toBe(candidate.basketId);
    expect(intent.basketVersion).toBe(approved.basketVersion);
    expect(intent.basketFingerprint).toBe(approved.basketFingerprint);
    expect(Date.parse(intent.expiresAt)).toBe(Date.parse(INTENT_AT) + 15 * 60 * 1000);
  });

  it("invalidates approval when the basket materially changes before dispatch", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approved = approveBasket(pending, candidate, "James", APPROVED_AT, NOW);
    const changed = { ...candidate, totalCost: candidate.totalCost + 1 };

    expect(validateBasketApproval(approved, changed, NOW)).toEqual({
      valid: false,
      reason: "BASKET_CHANGED",
    });
    expect(() => createDispatchIntent(approved, changed, INTENT_AT)).toThrow(
      "Cannot create dispatch intent: BASKET_CHANGED",
    );
  });

  it("rejects approval provenance without silently widening the authority boundary", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => approveBasket(pending, candidate, "   ", APPROVED_AT, NOW)).toThrow(
      "Cannot approve basket: APPROVAL_ACTOR_REQUIRED",
    );
    expect(() => approveBasket(pending, candidate, "James", "2026-08-22T00:31:00.000Z", NOW)).toThrow(
      "Cannot approve basket: APPROVAL_TIMESTAMP_FUTURE",
    );
  });
});
