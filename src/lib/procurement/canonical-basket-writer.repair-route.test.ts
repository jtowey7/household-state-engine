import { describe, expect, it } from "vitest";
import { approveBasket, basketApprovalFingerprint, createBasketApproval } from "./approval";
import { judgeCandidateBasket } from "./judge";
import { persistCanonicalBasketCandidate } from "./canonical-basket-writer";
import type { CandidateBasket } from "./types";

function basket(): CandidateBasket {
  return {
    basketId: "writer-repair-route-test",
    planId: "writer-repair-plan",
    snapshotId: "writer-repair-snapshot",
    replayId: "writer-repair-replay",
    replayTimestamp: "2026-08-28T01:00:00.000Z",
    retailer: "Tesco",
    lines: [{
      itemKey: "chicken-breast",
      sku: "TESCO-CHICKEN-1KG",
      productName: "Chicken Breast Fillets 1kg",
      productUrl: "https://www.tesco.com/shop/en-GB/products/123456789",
      retailer: "Tesco",
      requiredQuantity: 780,
      unit: "g",
      packSize: 1000,
      packUnit: "g",
      packCount: 1,
      orderedQuantity: 1000,
      lineCost: 6.69,
      sourceEventIds: ["evt-1"],
      requirementIds: ["req-1"],
      requirementCount: 1,
    }],
    exceptions: [],
    totalCost: 6.69,
    coverage: {
      demandItemKeys: ["chicken-breast"],
      sourcedItemKeys: ["chicken-breast"],
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
  };
}

function response(payload: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(payload), json: async () => payload };
}

describe("persistCanonicalBasketCandidate Family Alpha repair route", () => {
  it("delegates the stable Family Alpha repair run through the governed writer without creating a new approval", async () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approval = approveBasket(pending, candidate, "James", "2026-08-28T01:10:00.000Z", "2026-08-28T01:20:00.000Z");
    const fingerprint = basketApprovalFingerprint(candidate);
    const judgeId = judgeCandidateBasket(candidate).judgeId;
    const calls: string[] = [];

    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      if (method === "GET") {
        return response({ records: [{ id: "rec-approved", fields: {
          Basket: candidate.basketId,
          "Approval status": "APPROVED",
          "Approval ID": approval.approvalId,
          "Basket version": approval.basketVersion,
          "Basket fingerprint": fingerprint,
          "Approved at": approval.approvedAt,
          "Approved by": approval.approvedBy,
          "Judge ID": judgeId,
          "Approval policy identity": approval.policyIdentity,
          "Approval policy version": approval.policyVersion,
          "Basket payload": JSON.stringify({ compact: true }),
        }}] });
      }
      return response({ id: "rec-approved", fields: {
        "Basket fingerprint": fingerprint,
        "Basket payload": JSON.stringify(candidate),
      }});
    };

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test", baseId: "app-test" },
      candidate,
      fetchImpl,
      "family-alpha-basket-repair-2026-08-28T08:00:00.000Z",
    );

    expect(result).toEqual({
      status: "PERSISTED",
      recordId: "rec-approved",
      basketId: candidate.basketId,
      approvalId: "existing-approved-basket",
    });
    expect(calls).toEqual(["GET", "PATCH"]);
  });

  it("preserves the repair refusal when approval fingerprint conflicts", async () => {
    const candidate = basket();
    const pending = createBasketApproval(candidate);
    const approval = approveBasket(pending, candidate, "James", "2026-08-28T01:10:00.000Z", "2026-08-28T01:20:00.000Z");
    const fetchImpl = async () => response({ records: [{ id: "rec-conflict", fields: {
      Basket: candidate.basketId,
      "Approval status": "APPROVED",
      "Approval ID": approval.approvalId,
      "Basket version": approval.basketVersion,
      "Basket fingerprint": "different",
      "Approved at": approval.approvedAt,
      "Approved by": approval.approvedBy,
      "Judge ID": approval.judgeId,
      "Approval policy identity": approval.policyIdentity,
      "Approval policy version": approval.policyVersion,
      "Basket payload": JSON.stringify({ compact: true }),
    }}] });

    const result = await persistCanonicalBasketCandidate(
      { apiKey: "test", baseId: "app-test" },
      candidate,
      fetchImpl,
      "family-alpha-basket-repair-2026-08-28T08:00:00.000Z",
    );

    expect(result).toEqual({
      status: "REFUSED",
      detail: `BASKET_ID_FINGERPRINT_CONFLICT: Basket ${candidate.basketId} has a different stored fingerprint.`,
    });
  });
});
