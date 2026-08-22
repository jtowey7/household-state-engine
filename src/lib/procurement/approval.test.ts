import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import { hashOf } from "../state-engine/hash";
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
const approvalTime = "2026-08-14T01:05:00.000Z";
const now = "2026-08-14T01:06:00.000Z";

describe("versioned procurement approvals", () => {
  it("creates a pending approval bound to the exact basket and judge fingerprint", () => {
    const candidate = basket();
    const approval = createBasketApproval(candidate);

    expect(approval.status).toBe("PENDING");
    expect(approval.basketId).toBe(candidate.basketId);
    expect(approval.basketVersion).toBe(1);
    expect(approval.basketFingerprint).toBe(basketApprovalFingerprint(candidate));
    expect(approval.judgeId).toBeTruthy();
    expect(validateBasketApproval(approval, candidate)).toEqual({ valid: false, reason: "NOT_APPROVED" });
  });

  it("binds human approval to version 1 and accepts the unchanged basket", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approved = approveBasket(pending, candidate, "james", approvalTime, now);

    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe("james");
    expect(validateBasketApproval(approved, candidate, now)).toEqual({ valid: true });
  });

  it("rejects actor tampering after approval", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const forged = { ...approved, approvedBy: "other-user" };

    expect(validateBasketApproval(forged, candidate, now)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });

  it("rejects approval timestamp tampering after approval", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const forged = { ...approved, approvedAt: "2026-08-14T01:05:30.000Z" };

    expect(validateBasketApproval(forged, candidate, now)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });

  it("rejects a future approval timestamp at creation", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() =>
      approveBasket(pending, candidate, "james", "2026-08-14T01:07:00.000Z", now),
    ).toThrow("APPROVAL_TIMESTAMP_FUTURE");
  });

  it("rejects an approval that is future-dated at execution", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approved = approveBasket(
      pending,
      candidate,
      "james",
      "2026-08-14T01:10:00.000Z",
      "2026-08-14T01:11:00.000Z",
    );

    expect(validateBasketApproval(approved, candidate, "2026-08-14T01:09:00.000Z")).toEqual({
      valid: false,
      reason: "APPROVAL_TIMESTAMP_FUTURE",
    });
  });

  it("rejects a forged approval id at execution", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const forged = { ...approved, approvalId: "FORGED-APPROVAL-ID" };

    expect(validateBasketApproval(forged, candidate, now)).toEqual({
      valid: false,
      reason: "APPROVAL_PROVENANCE_INVALID",
    });
  });

  it("rejects an unsafe approval version at execution", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const forged = { ...approved, basketVersion: Number.MAX_SAFE_INTEGER + 1 };

    expect(validateBasketApproval(forged, candidate, now)).toEqual({
      valid: false,
      reason: "VERSION_MISMATCH",
    });
  });

  it("rejects approval without a non-blank human actor", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => approveBasket(pending, candidate, "   ", approvalTime, now)).toThrow(
      "APPROVAL_ACTOR_REQUIRED",
    );
  });

  it("rejects approval without a valid approval timestamp", () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);

    expect(() => approveBasket(pending, candidate, "james", "not-a-timestamp", now)).toThrow(
      "APPROVAL_TIMESTAMP_INVALID",
    );
  });

  it("invalidates approval when a material basket mutation occurs", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const changed = aggregateCandidateBasket(
      { ...plan, requirements: [{ ...plan.requirements[0]!, requiredQuantity: 3 }] },
      { catalogue: shadowCatalogue },
    );

    expect(changed.basketId).not.toBe(candidate.basketId);
    expect(validateBasketApproval(approved, changed, now)).toEqual({ valid: false, reason: "BASKET_CHANGED" });

    const next = supersedeBasketApproval(approved, changed);
    expect(next.basketVersion).toBe(2);
    expect(next.status).toBe("PENDING");
    expect(next.basketFingerprint).toBe(basketApprovalFingerprint(changed));
  });

  it("supersedes approval when replay identity changes even if basket lines are unchanged", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const replayChanged = aggregateCandidateBasket(
      { ...plan, replayId: "R-APPROVAL-NEW", replayTimestamp: "2026-08-14T02:00:00.000Z" },
      { catalogue: shadowCatalogue },
    );

    expect(replayChanged.basketId).toBe(candidate.basketId);
    expect(replayChanged.lines).toEqual(candidate.lines);
    expect(basketApprovalFingerprint(replayChanged)).not.toBe(basketApprovalFingerprint(candidate));
    expect(validateBasketApproval(approved, replayChanged, now)).toEqual({
      valid: false,
      reason: "BASKET_CHANGED",
    });

    const next = supersedeBasketApproval(approved, replayChanged);
    expect(next.basketVersion).toBe(2);
    expect(next.status).toBe("PENDING");
    expect(next.approvedAt).toBeNull();
    expect(next.approvedBy).toBeNull();
  });

  it("rejects approval when the judge result drifts even though the basket fingerprint is unchanged", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
    const driftedJudge = "JUDGE-DRIFTED";
    const forged = {
      ...approved,
      judgeId: driftedJudge,
      approvalId: hashOf({
        basketId: approved.basketId,
        basketVersion: approved.basketVersion,
        fingerprint: approved.basketFingerprint,
        judgeId: driftedJudge,
        approvedAt: approved.approvedAt,
        approvedBy: approved.approvedBy,
      }),
    };

    expect(forged.basketFingerprint).toBe(approved.basketFingerprint);
    expect(validateBasketApproval(forged, candidate, now)).toEqual({
      valid: false,
      reason: "JUDGE_RESULT_CHANGED",
    });
  });

  it("does not create a new version for an identical basket", () => {
    const candidate = basket();
    const approved = approveBasket(createBasketApproval(candidate), candidate, "james", approvalTime, now);
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

    expect(() => approveBasket(pending, incomplete, "james", approvalTime, now)).toThrow(
      "BASKET_NOT_APPROVABLE",
    );
  });
});
