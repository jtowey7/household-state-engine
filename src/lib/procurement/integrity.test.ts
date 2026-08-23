import { describe, expect, it } from "vitest";

import { aggregateCandidateBasket, shadowCatalogue } from ".";
import { requirementIdentity } from "./adapter";
import { validateBasketIntegrity } from "./integrity";
import { judgeCandidateBasket } from "./judge";
import type { CandidateBasket } from "./types";
import type { QuantityRequirement, QuantityRunPlan } from "../quantity-adapter/types";

const oats: QuantityRequirement = {
  requirementId: "REQ-OATS-1",
  itemKey: "oats-rolled",
  requiredQuantity: 1200,
  unit: "g",
  onHandQuantity: 800,
  targetQuantity: 2000,
  sourceEventIds: ["OPEN-A", "EVT-1"],
  packSize: 500,
  packCount: 3,
  packRoundedQuantity: 1500,
};

const milk: QuantityRequirement = {
  requirementId: "REQ-MILK-1",
  itemKey: "milk-whole",
  requiredQuantity: 2,
  unit: "L",
  onHandQuantity: 4,
  targetQuantity: 6,
  sourceEventIds: ["OPEN-B"],
  packSize: 1,
  packCount: 2,
  packRoundedQuantity: 2,
};

const plan: QuantityRunPlan = {
  replayId: "R1",
  snapshotId: "S1",
  replayTimestamp: "2026-08-03T20:00:00.000Z",
  reconciliationStatus: "CLEAN",
  planId: "P1",
  eligibleForProcurement: true,
  executed: true,
  blockedItemKeys: [],
  rejections: [],
  requirements: [oats, milk],
};

const opts = { catalogue: shadowCatalogue };

describe("procurement integrity: duplicate demand and coverage", () => {
  it("dedupes the identical requirement delivered twice in one run", () => {
    const base = aggregateCandidateBasket(plan, opts);
    const doubled = aggregateCandidateBasket({ ...plan, requirements: [oats, milk, { ...oats }] }, opts);

    expect(doubled.lines).toHaveLength(2);
    const line = doubled.lines.find((l) => l.itemKey === "oats-rolled")!;
    expect(line.requiredQuantity).toBe(1200);
    expect(line.requirementCount).toBe(1);
    expect(line.packCount).toBe(base.lines.find((l) => l.itemKey === "oats-rolled")!.packCount);
    expect(doubled.basketId).toBe(base.basketId);
    expect(doubled.totalCost).toBe(base.totalCost);
  });

  it("aggregates two genuinely distinct requirements for one item into one line", () => {
    const second: QuantityRequirement = {
      ...oats,
      requirementId: "REQ-OATS-2",
      requiredQuantity: 300,
      sourceEventIds: ["EVT-1", "EVT-9"],
    };
    const basket = aggregateCandidateBasket({ ...plan, requirements: [oats, second, milk] }, opts);
    const line = basket.lines.find((l) => l.itemKey === "oats-rolled")!;
    expect(basket.lines.filter((l) => l.itemKey === "oats-rolled")).toHaveLength(1);
    expect(line.requiredQuantity).toBe(1500);
    expect(line.requirementCount).toBe(2);
    expect(line.requirementIds).toEqual(["REQ-OATS-1", "REQ-OATS-2"]);
    expect(line.sourceEventIds).toEqual(["OPEN-A", "EVT-1", "EVT-9"]);
  });

  it("is observationally idempotent across repeated aggregation of the same input", () => {
    const a = aggregateCandidateBasket(plan, opts);
    const b = aggregateCandidateBasket(plan, opts);
    expect(b.basketId).toBe(a.basketId);
    expect(b.lines).toEqual(a.lines);
    expect(b.coverage).toEqual(a.coverage);
    expect(b.totalCost).toBe(a.totalCost);
  });

  it("derives a stable requirement identity when the plan supplied none", () => {
    const { requirementId: _drop, ...bare } = oats;
    const id = requirementIdentity(bare);
    expect(id).toBe(requirementIdentity({ ...bare }));
    const basket = aggregateCandidateBasket({ ...plan, requirements: [bare, { ...bare }] }, opts);
    const line = basket.lines.find((l) => l.itemKey === "oats-rolled")!;
    expect(line.requirementIds).toEqual([id]);
    expect(line.requiredQuantity).toBe(1200);
  });

  it("reports complete coverage only when every demanded item is sourced", () => {
    const complete = aggregateCandidateBasket(plan, opts);
    expect(complete.complete).toBe(true);
    expect(complete.coverage.unsourcedItemKeys).toEqual([]);
    expect(complete.coverage.sourcedItemKeys).toEqual(["milk-whole", "oats-rolled"]);
    expect(complete.readyForApproval).toBe(true);
  });

  it("keeps a mixed sourced + unsourceable basket explicitly incomplete", () => {
    const saffron: QuantityRequirement = {
      requirementId: "REQ-SAFFRON-1",
      itemKey: "saffron-threads",
      requiredQuantity: 5,
      unit: "g",
      onHandQuantity: 0,
      targetQuantity: 5,
      sourceEventIds: ["OPEN-Z"],
      packSize: null,
      packCount: null,
      packRoundedQuantity: null,
    };
    const basket = aggregateCandidateBasket({ ...plan, requirements: [...plan.requirements, saffron] }, opts);
    expect(basket.lines).toHaveLength(2);
    expect(basket.coverage.demandItemKeys).toEqual(["milk-whole", "oats-rolled", "saffron-threads"]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["saffron-threads"]);
    expect(basket.complete).toBe(false);
    expect(basket.readyForReview).toBe(true);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.dispatched).toBe(false);
    expect(basket.exceptions.map((e) => e.code)).toEqual(["NO_CATALOGUE_MATCH"]);
  });

  it("withholds an item demanded twice in incompatible units instead of converting", () => {
    const kgOats: QuantityRequirement = { ...oats, requirementId: "REQ-OATS-KG", requiredQuantity: 1.2, unit: "kg" };
    const basket = aggregateCandidateBasket({ ...plan, requirements: [oats, kgOats, milk] }, opts);
    expect(basket.lines.map((l) => l.itemKey)).toEqual(["milk-whole"]);
    expect(basket.exceptions.map((e) => e.code)).toEqual(["DUPLICATE_REQUIREMENT_UNIT_CONFLICT"]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["oats-rolled"]);
    expect(basket.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });

  it("treats incompatible pack evidence as unsourced, not as covered demand", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, requirements: [oats] },
      {
        catalogue: [
          {
            itemKey: "oats-rolled",
            sku: "SKU-BAD",
            productName: "Oats (kg pack)",
            retailer: "synthetic-grocer",
            packSize: 1,
            packUnit: "kg",
            packPrice: 2,
          },
        ],
      },
    );
    expect(basket.lines).toEqual([]);
    expect(basket.exceptions.map((e) => e.code)).toEqual(["PACK_UNIT_MISMATCH"]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["oats-rolled"]);
    expect(basket.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
  });

  it("an ineligible plan yields no coverage claim at all", () => {
    const basket = aggregateCandidateBasket(
      { ...plan, executed: false, eligibleForProcurement: false, reconciliationStatus: "BLOCKED" },
      opts,
    );
    expect(basket.complete).toBe(false);
    expect(basket.coverage.demandItemKeys).toEqual([]);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.dispatched).toBe(false);
    expect(basket.requiresHumanApproval).toBe(true);
  });

  it("refuses forged requirement-count provenance even when the rest of the basket is valid", () => {
    const basket = aggregateCandidateBasket(plan, opts);
    const forged = {
      ...basket,
      lines: basket.lines.map((line) =>
        line.itemKey === "oats-rolled" ? { ...line, requirementCount: line.requirementCount + 1 } : line,
      ),
    } as CandidateBasket;

    expect(validateBasketIntegrity(forged)).toContainEqual({
      code: "REQUIREMENT_COUNT_MISMATCH",
      itemKey: "oats-rolled",
      detail: 'Line "oats-rolled" reports requirementCount 2 but carries 1 requirement ID(s).',
    });
    expect(judgeCandidateBasket(forged).verdict).toBe("REFUSE");
    expect(judgeCandidateBasket(forged).readyForApproval).toBe(false);
  });

  it("refuses duplicate requirement IDs even when count matches", () => {
    const basket = aggregateCandidateBasket(plan, opts);
    const forged = {
      ...basket,
      lines: basket.lines.map((line) =>
        line.itemKey === "oats-rolled"
          ? { ...line, requirementIds: ["REQ-OATS-1", "REQ-OATS-1"], requirementCount: 2 }
          : line,
      ),
    } as CandidateBasket;

    expect(validateBasketIntegrity(forged)).toContainEqual({
      code: "DUPLICATE_REQUIREMENT_IDS",
      itemKey: "oats-rolled",
      detail: 'Line "oats-rolled" repeats requirement ID "REQ-OATS-1".',
    });
    expect(judgeCandidateBasket(forged).verdict).toBe("REFUSE");
    expect(judgeCandidateBasket(forged).readyForApproval).toBe(false);
  });

  it("refuses a basket whose lifecycle flags are unsafe even when every economic/coverage check passes", () => {
    const basket = {
      basketId: "BASKET-LIFECYCLE-1",
      planId: "PLAN-1",
      snapshotId: "SNAP-1",
      replayId: "REPLAY-1",
      replayTimestamp: "2026-08-16T08:00:00.000Z",
      retailer: "Synthetic Tesco",
      lines: [
        {
          itemKey: "milk",
          sku: "MILK-1",
          productName: "Milk 2L",
          retailer: "Synthetic Tesco",
          requiredQuantity: 2,
          unit: "L",
          packSize: 2,
          packUnit: "L",
          packCount: 1,
          orderedQuantity: 2,
          lineCost: 1.8,
          sourceEventIds: ["E1"],
          requirementIds: ["R1"],
          requirementCount: 1,
        },
      ],
      exceptions: [],
      totalCost: 1.8,
      coverage: {
        demandItemKeys: ["milk"],
        sourcedItemKeys: ["milk"],
        unsourcedItemKeys: [],
        complete: true,
      },
      complete: true,
      readyForReview: true,
      readyForApproval: true,
      dispatched: true,
      requiresHumanApproval: false,
    } as unknown as CandidateBasket;

    expect(validateBasketIntegrity(basket)).toContainEqual({
      code: "INVALID_LIFECYCLE_FLAGS",
      itemKey: null,
      detail: "Basket lifecycle flags are unsafe: dispatch must remain false and human approval must remain required.",
    });
    expect(judgeCandidateBasket(basket).verdict).toBe("REFUSE");
    expect(judgeCandidateBasket(basket).readyForApproval).toBe(false);
  });
});

describe("weekly cycle never approves an incomplete basket as complete", () => {
  it("flags incomplete coverage in the approval gate and dispatches nothing", async () => {
    const { runShadowHouseholdCycle } = await import("../shadow-household/shadow-run");
    const run = await runShadowHouseholdCycle();
    const basket = run.basket!;
    expect(basket.dispatched).toBe(false);
    expect(run.approval.granted).toBe(false);
    if (basket.complete) {
      expect(basket.readyForApproval).toBe(true);
    } else {
      expect(basket.readyForApproval).toBe(false);
      expect(run.approval.readyForReview ? run.approval.reason : "INCOMPLETE").toContain("INCOMPLETE");
      for (const key of basket.coverage.unsourcedItemKeys) {
        expect(basket.lines.some((l) => l.itemKey === key)).toBe(false);
      }
    }
    for (const line of basket.lines) {
      expect(line.requirementIds.length).toBeGreaterThan(0);
      expect(line.requirementCount).toBe(line.requirementIds.length);
      const planned = run.plan!.requirements.filter((r) => r.itemKey === line.itemKey);
      expect(line.requirementIds.sort()).toEqual(planned.map((r) => r.requirementId!).sort());
    }
  });
});
