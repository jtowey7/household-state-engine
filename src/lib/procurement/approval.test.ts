import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import {
  approveBasket,
  basketApprovalFingerprint,
  createBasketApproval,
  supersedeBasketApproval,
  validateBasketApproval,
} from "./approval";

const plan: QuantityRunPlan = {
  replayId: "R-APPROVAL",
  snapshotId: "S-APPROVAL",
  replayTimestamp: "2026-08-14T01:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P-APPROVAL",
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

const basket = () => aggregateCandidateBasket(plan, { catalogue: shadowCatalogue });

describe("versioned procurement approvals", () => {
  it("creates a pending approval bound to the exact basket fingerprint", () => {
    const candidate = basket();
    const approval = createBasketApproval(candidate);

    expect(approval.status).toBe("PENDING");
    expect(approval.basketId).toBe(candidate.basketId);
    expect(approval.basketVersion).toBe(1);
    expect(approval.basketFingerprint).toBe(basketApprovalFingerprint(candidate));
    expect(validateBasketApproval(approval, candidate)).toEqual({ valid: false, reason: "NOT_APPROVED" });
  });

  it("binds human approval to version 1 and accepts the unchanged basket", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approved = approveBasket(pending, candidate, "james", "2026-08-14T01:05:00.000Z");

    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe("james");
    expect(validateBasketApproval(approved, candidate)).toEqual({ valid: true });
  });

  it("rejects a forged approval id at execution", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T01:05:00.000Z",
    );

    const forged = { ...approved, approvalId: "FORGED-APPROVAL-ID" };
    expect(validateBasketApproval(forged, candidate)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });

  it("rejects approval provenance tampering even when the original approval id remains valid", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T01:05:00.000Z",
    );

    const forgedActor = { ...approved, approvedBy: "attacker" };
    const forgedTimestamp = { ...approved, approvedAt: "2026-08-14T02:05:00.000Z" };

    expect(validateBasketApproval(forgedActor, candidate)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
    expect(validateBasketApproval(forgedTimestamp, candidate)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });

  it("rejects an unsafe approval version at execution", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T01:05:00.000Z",
    );

    const forged = { ...approved, basketVersion: Number.MAX_SAFE_INTEGER + 1 };
    expect(validateBasketApproval(forged, candidate)).toEqual({
      valid: false,
      reason: "VERSION_MISMATCH",
    });
  });

  it("rejects approval without a non-blank human actor", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => approveBasket(pending, candidate, "   ", "2026-08-14T01:05:00.000Z")).toThrow(
      "APPROVAL_ACTOR_REQUIRED",
    );
  });

  it("rejects approval without a valid approval timestamp", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => approveBasket(pending, candidate, "james", "not-a-timestamp")).toThrow(
      "APPROVAL_TIMESTAMP_INVALID",
    );
  });

  it("invalidates approval when a material basket mutation occurs", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T01:05:00.000Z",
    );
    const changed = aggregateCandidateBasket(
      { ...plan, requirements: [{ ...plan.requirements[0]!, requiredQuantity: 3 }] },
      { catalogue: shadowCatalogue },
    );

    expect(changed.basketId).not.toBe(candidate.basketId);
    expect(validateBasketApproval(approved, changed)).toEqual({ valid: false, reason: "BASKET_CHANGED" });

    const next = supersedeBasketApproval(approved, changed);
    expect(next.basketVersion).toBe(2);
    expect(next.status).toBe("PENDING");
    expect(next.basketFingerprint).toBe(basketApprovalFingerprint(changed));
  });

  it("does not create a new version for an identical basket", () => {
    const candidate = basket();
    const approved = approveBasket(
      createBasketApproval(candidate),
      candidate,
      "james",
      "2026-08-14T01:05:00.000Z",
    );
    const identical = basket();
    const next = supersedeBasketApproval(approved, identical);

    expect(next).toEqual(approved);
    expect(next.basketVersion).toBe(1);
  });

  it("refuses approval for an incomplete basket", () => {
    const incomplete = aggregateCandidateBasket(
      {
        ...plan,
        requirements: [
          ...plan.requirements,
          {
            requirementId: "REQ-UNKNOWN",
            itemKey: "unknown-item",
            requiredQuantity: 1,
            unit: "each",
            onHandQuantity: 0,
            targetQuantity: 1,
            sourceEventIds: ["EVT-UNKNOWN"],
            packSize: null,
            packCount: null,
            packRoundedQuantity: null,
          },
        ],
      },
      { catalogue: shadowCatalogue },
    );
    const pending = createBasketApproval(incomplete);

    expect(() => approveBasket(pending, incomplete, "james", "2026-08-14T01:05:00.000Z")).toThrow(
      "BASKET_NOT_APPROVABLE",
    );
  });
});
