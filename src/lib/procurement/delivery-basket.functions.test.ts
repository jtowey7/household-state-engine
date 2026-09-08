import { describe, expect, it } from "vitest";

import { legacyDeliveryJudge } from "./delivery-basket.functions";
import type { CandidateBasket } from "./types";

function basketWith(lines: CandidateBasket["lines"], exceptions: CandidateBasket["exceptions"]): CandidateBasket {
  return {
    basketId: "family-alpha-test",
    planId: "2026-09-07 week",
    snapshotId: "snapshot",
    replayId: "replay",
    replayTimestamp: "2026-09-08T10:00:00.000Z",
    retailer: "Tesco",
    lines,
    exceptions,
    totalCost: 1,
    coverage: {
      demandItemKeys: lines.map((line) => line.itemKey),
      sourcedItemKeys: lines.map((line) => line.itemKey),
      unsourcedItemKeys: [],
      complete: true,
    },
    complete: true,
    readyForReview: true,
    readyForApproval: false,
    dispatched: false,
    requiresHumanApproval: true,
  };
}

function line(itemKey: string, unit: string, packUnit: string) {
  return {
    itemKey,
    sku: "sku",
    productName: itemKey,
    retailer: "Tesco",
    requiredQuantity: 4,
    unit,
    packSize: 1,
    packUnit,
    packCount: 4,
    orderedQuantity: 4,
    lineCost: 1,
    productUrl: "https://www.tesco.com/shop/en-GB/products/sku",
    sourceEventIds: [],
    requirementIds: ["requirement"],
    requirementCount: 1,
  };
}

describe("legacyDeliveryJudge", () => {
  it("permits an explicit non-fatal pack-unit exception while retaining review", () => {
    const result = legacyDeliveryJudge(
      basketWith([line("celery", "stick", "each")], [
        {
          code: "PACK_UNIT_MISMATCH",
          itemKey: "celery",
          detail: "Demand is sticks; catalogue is each.",
          fatal: false,
        },
      ]),
      "judge-1",
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({ judgeId: "judge-1", verdict: "NEEDS_REVIEW", readyForApproval: false });
  });

  it("still rejects a pack-unit mismatch without the matching explicit exception", () => {
    const result = legacyDeliveryJudge(basketWith([line("celery", "stick", "each")], []), "judge-1");

    expect(result).toEqual({ error: "INVALID_LINE_ARITHMETIC:celery" });
  });

  it("does not let an exception for one item excuse another mismatched line", () => {
    const result = legacyDeliveryJudge(
      basketWith(
        [line("celery", "stick", "each"), line("carrots", "carrot", "kg")],
        [
          {
            code: "PACK_UNIT_MISMATCH",
            itemKey: "celery",
            detail: "Demand is sticks; catalogue is each.",
            fatal: false,
          },
        ],
      ),
      "judge-1",
    );

    expect(result).toEqual({ error: "INVALID_LINE_ARITHMETIC:carrots" });
  });
});
