import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import { hashOf } from "../state-engine/hash";
import {
  approveBasket,
  basketApprovalFingerprint,
  createBasketApproval,
} from "./approval";
import { createDispatchIntent } from "./dispatch";

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

describe("approval-bound dispatch gate", () => {
  it("creates a deterministic, time-bounded external dispatch intent only from an approved basket", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    const intent = createDispatchIntent(approved, candidate, "2026-08-14T02:06:00.000Z");

    expect(intent.status).toBe("READY");
    expect(intent.requiresExternalDispatch).toBe(true);
    expect(intent.basketId).toBe(candidate.basketId);
    expect(intent.basketVersion).toBe(approved.basketVersion);
    expect(intent.basketFingerprint).toBe(approved.basketFingerprint);
    expect(intent.expiresAt).toBe("2026-08-14T02:21:00.000Z");
    expect(intent.dispatchId).toBe(
      createDispatchIntent(approved, candidate, "2026-08-15T02:06:00.000Z").dispatchId,
    );
  });

  it("refuses an unapproved basket", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => createDispatchIntent(pending, candidate, "2026-08-14T02:06:00.000Z")).toThrow(
      "NOT_APPROVED",
    );
  });

  it("refuses an intent created before the human approval", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T02:05:00.000Z",
    );

    expect(() => createDispatchIntent(approved, candidate, "2026-08-14T02:04:00.000Z")).toThrow(
      "APPROVAL_TIMESTAMP_FUTURE",
    );
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

    expect(() => createDispatchIntent(approved, changed, "2026-08-14T02:06:00.000Z")).toThrow(
      "BASKET_CHANGED",
    );
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

    expect(() => createDispatchIntent(forged, candidate, "2026-08-14T02:06:00.000Z")).toThrow(
      "APPROVAL_PROVENANCE_INVALID",
    );
  });
});
