import { describe, expect, it } from "vitest";
import { approveBasket, basketApprovalFingerprint, createBasketApproval, type BasketApproval } from "./approval";
import { judgeCandidateBasket } from "./judge";
import { repairCanonicalBasketPayload } from "./canonical-basket-payload-repair";
import type { CandidateBasket } from "./types";

function basket(): CandidateBasket {
  return {
    basketId: "repair-test-basket",
    planId: "repair-test-plan",
    snapshotId: "repair-test-snapshot",
    replayId: "repair-test-replay",
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
    coverage: { demandItemKeys: ["chicken-breast"], sourcedItemKeys: ["chicken-breast"], unsourcedItemKeys: [], complete: true },
    complete: true,
    readyForReview: true,
    readyForApproval: true,
    dispatched: false,
    requiresHumanApproval: true,
  };
}

function approvalFor(candidate: CandidateBasket, overrides: Partial<BasketApproval> = {}): BasketApproval {
  const pending = createBasketApproval(candidate);
  return {
    ...approveBasket(pending, candidate, "James", "2026-08-28T01:10:00.000Z", "2026-08-28T01:20:00.000Z"),
    ...overrides,
  };
}

function response(payload: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(payload), json: async () => payload };
}

describe("repairCanonicalBasketPayload", () => {
  it("repairs only the payload while preserving valid approval provenance", async () => {
    const candidate = basket();
    const fingerprint = basketApprovalFingerprint(candidate);
    const approval = approvalFor(candidate);
    const judgeId = judgeCandidateBasket(candidate).judgeId;
    const calls: { method: string; body?: string }[] = [];
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body });
      if (method === "GET") {
        return response({ records: [{ id: "rec-approved-1", fields: {
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
      return response({ id: "rec-approved-1", fields: { "Basket fingerprint": fingerprint, "Basket payload": JSON.stringify(candidate) } });
    };

    const result = await repairCanonicalBasketPayload({ apiKey: "test", baseId: "app-test" }, candidate, fetchImpl);
    expect(result).toEqual({ status: "REPAIRED", recordId: "rec-approved-1", basketId: candidate.basketId, fingerprint });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    const body = JSON.parse(calls[1]!.body!);
    expect(Object.keys(body.fields)).toEqual(["Basket payload"]);
  });

  it("refuses an existing row with a different fingerprint", async () => {
    const candidate = basket();
    const approval = approvalFor(candidate, { basketFingerprint: "different" });
    const fetchImpl = async () => response({ records: [{ id: "rec-conflict", fields: {
      Basket: candidate.basketId,
      "Approval status": "APPROVED",
      "Approval ID": approval.approvalId,
      "Basket version": approval.basketVersion,
      "Basket fingerprint": approval.basketFingerprint,
      "Approved at": approval.approvedAt,
      "Approved by": approval.approvedBy,
      "Judge ID": approval.judgeId,
      "Approval policy identity": approval.policyIdentity,
      "Approval policy version": approval.policyVersion,
      "Basket payload": JSON.stringify({ compact: true }),
    }}] });
    const result = await repairCanonicalBasketPayload({ apiKey: "test", baseId: "app-test" }, candidate, fetchImpl);
    expect(result).toEqual({ status: "REFUSED", detail: `BASKET_ID_FINGERPRINT_CONFLICT: Basket ${candidate.basketId} has a different stored fingerprint.` });
  });

  it("does not mutate a complete payload", async () => {
    const candidate = basket();
    const approval = approvalFor(candidate);
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      return response({ records: [{ id: "rec-complete", fields: {
        Basket: candidate.basketId,
        "Approval status": "APPROVED",
        "Approval ID": approval.approvalId,
        "Basket version": approval.basketVersion,
        "Basket fingerprint": approval.basketFingerprint,
        "Approved at": approval.approvedAt,
        "Approved by": approval.approvedBy,
        "Judge ID": approval.judgeId,
        "Approval policy identity": approval.policyIdentity,
        "Approval policy version": approval.policyVersion,
        "Basket payload": JSON.stringify(candidate),
      }}] });
    };
    const result = await repairCanonicalBasketPayload({ apiKey: "test", baseId: "app-test" }, candidate, fetchImpl);
    expect(result).toEqual({ status: "NO_OP", recordId: "rec-complete", basketId: candidate.basketId });
    expect(calls).toEqual(["GET"]);
  });
});
