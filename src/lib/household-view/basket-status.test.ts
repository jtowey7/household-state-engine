import { describe, expect, it } from "vitest";

import { describeBasketStatus, describeHomeHeadline } from "./basket-status";
import type { CanonicalBasketReadResult } from "../procurement/canonical-basket";

const emptyCanonical: CanonicalBasketReadResult = {
  status: "NOT_READY",
  source: "AIRTABLE_CANONICAL",
  reason: "NO_REVIEWABLE_BASKET",
  detail: "BASKET CANDIDATES contains no pending or approved basket with a canonical Basket payload.",
};

describe("household basket status wording", () => {
  it("is never actionable while the canonical read is still pending", () => {
    const status = describeBasketStatus(null);
    expect(status.actionable).toBe(false);
    expect(status.ctaLabel).not.toMatch(/review basket/i);
  });

  it("fails closed and names the serving-count blocker when canonical BASKET CANDIDATES is empty", () => {
    const status = describeBasketStatus(emptyCanonical);
    expect(status.actionable).toBe(false);
    expect(status.ctaLabel).toBe("No basket to review");
    expect(status.blocker).toMatch(/serving counts/i);
    expect(status.blocker).not.toMatch(/£/);
  });

  it("never claims food is under control when no canonical basket exists", () => {
    const headline = describeHomeHeadline(emptyCanonical);
    expect(`${headline.line1} ${headline.line2}`).not.toMatch(/under control/i);
    expect(headline.line2).toMatch(/no shopping plan is ready/i);
  });

  it("gives every NOT_READY reason plain-English wording without engine jargon", () => {
    const reasons = [
      "NO_REVIEWABLE_BASKET",
      "AMBIGUOUS_REVIEWABLE_BASKETS",
      "BASKET_PAYLOAD_INVALID",
      "BASKET_NOT_APPROVABLE",
      "APPROVAL_PROVENANCE_INVALID",
      "CONNECTOR_NOT_CONFIGURED",
      "CONNECTOR_READ_FAILED",
    ] as const;

    for (const reason of reasons) {
      const status = describeBasketStatus({
        status: "NOT_READY",
        source: "AIRTABLE_CANONICAL",
        reason,
        detail: "x",
      });
      expect(status.actionable).toBe(false);
      expect(status.blocker).toBeTruthy();
      expect(status.blocker).not.toMatch(/snapshotId|replayId|CandidateBasket|BASKET CANDIDATES/);
    }
  });

  it("only becomes actionable on a READY canonical basket", () => {
    const status = describeBasketStatus({
      status: "READY",
      source: "AIRTABLE_CANONICAL",
      basket: { totalCost: 13.7, lines: [] } as never,
      approval: { status: "PENDING", judgeId: "j" },
    });
    expect(status.actionable).toBe(true);
    expect(describeHomeHeadline({
      status: "READY",
      source: "AIRTABLE_CANONICAL",
      basket: { totalCost: 13.7, lines: [] } as never,
      approval: { status: "PENDING", judgeId: "j" },
    }).line1).toMatch(/under control/i);
  });
});
