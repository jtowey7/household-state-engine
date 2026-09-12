/**
 * RED-TEAM: stale/clean handoff identity, Test-class isolation, procurement
 * aggregation and catalogue evidence — plus scheduler idempotency of the
 * planned-meal completion -> canonical consumption proposal seam.
 *
 * SYNTHETIC fixtures only. No Airtable, no production state, no dispatch.
 */
import { describe, expect, it } from "vitest";

import { runReplayToQuantityIntegration } from "../test-lab/harness";
import { aggregateCandidateBasket, aggregateItemDemand } from "../procurement/adapter";
import type { CatalogueEntry } from "../procurement/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type { HouseholdEvent } from "../state-engine/types";
import { proposeMealCompletionConsumption } from "../meal-completion/adapter";
import type { PlannedMealCompletion } from "../meal-completion/types";

const NOW = () => "2026-09-12T00:00:00.000Z";
const SALMON = "Tesco 6 Boneless Salmon Fillets 780G";

const targets: DemandTarget[] = [
  { itemKey: "eggs-large", targetQuantity: 24, unit: "count", packSize: 6, packUnit: "count" },
  { itemKey: "rice-basmati", targetQuantity: 4000, unit: "g", packSize: 1000, packUnit: "g" },
];

const catalogue: CatalogueEntry[] = [
  {
    itemKey: "eggs-large",
    sku: "SKU-EGGS-6",
    productName: "Free Range Large Eggs 6 Pack",
    retailer: "Tesco",
    packSize: 6,
    packUnit: "count",
    packPrice: 2.1,
  },
  {
    itemKey: "rice-basmati",
    sku: "SKU-RICE-1KG",
    productName: "Basmati Rice 1kg",
    retailer: "Tesco",
    packSize: 1000,
    packUnit: "g",
    packPrice: 2.5,
  },
];

const ledger: HouseholdEvent[] = [
  {
    eventId: "EVT-DELIVERY-EGGS",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "eggs-large",
    occurredAt: "2026-09-11T08:00:00.000Z",
    recordClass: "Production",
    payload: { quantity: 6, unit: "count", note: "Delivery" },
  },
  {
    eventId: "EVT-DELIVERY-RICE",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "rice-basmati",
    occurredAt: "2026-09-11T08:00:00.000Z",
    recordClass: "Production",
    payload: { quantity: 1000, unit: "g", note: "Delivery" },
  },
];

const chain = (events: readonly HouseholdEvent[]) =>
  runReplayToQuantityIntegration(events, { targets, now: NOW });

describe("handoff identity: stale snapshots cannot survive a new household event", () => {
  it("a new production event produces a new snapshot and plan identity", () => {
    const before = chain(ledger);
    const after = chain([
      ...ledger,
      {
        eventId: "EVT-CONSUME-EGGS",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: "eggs-large",
        occurredAt: "2026-09-11T19:00:00.000Z",
        recordClass: "Production",
        payload: { quantity: -2, unit: "count", note: "Breakfast" },
      },
    ]);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(after.replayId).not.toBe(before.replayId);
    expect(after.plan.planId).not.toBe(before.plan.planId);
    expect(after.plan.requirements.find((r) => r.itemKey === "eggs-large")).not.toEqual(
      before.plan.requirements.find((r) => r.itemKey === "eggs-large"),
    );
  });

  it("an unchanged clean ledger is reusable and byte-identical across runs", () => {
    const a = chain(ledger);
    const b = chain(ledger);
    expect(b.snapshotId).toBe(a.snapshotId);
    expect(b.plan.planId).toBe(a.plan.planId);
    expect(b.plan.requirements).toEqual(a.plan.requirements);
    expect(a.snapshot.reconciliationStatus).toBe("CLEAN");
  });

  it("Test-class source events never reach planning", () => {
    const withTest = chain([
      ...ledger,
      {
        eventId: "TEST-EVT-001",
        eventType: "ITEM_STOCK_DELTA",
        itemKey: "eggs-large",
        occurredAt: "2026-09-11T10:00:00.000Z",
        recordClass: "Test",
        payload: { quantity: 999, unit: "count", note: "synthetic" },
      },
    ]);
    const clean = chain(ledger);
    expect(withTest.snapshot.items.find((i) => i.itemKey === "eggs-large")?.quantity).toBe(6);
    expect(withTest.snapshotId).toBe(clean.snapshotId);
    expect(withTest.plan.planId).toBe(clean.plan.planId);
    expect(withTest.sourceEventIds).not.toContain("TEST-EVT-001");
  });
});

describe("procurement: aggregation cannot double, catalogue gaps are explicit", () => {
  it("the same requirement submitted twice does not double the demand", () => {
    const { plan } = chain(ledger);
    const rice = plan.requirements.find((r) => r.itemKey === "rice-basmati")!;
    const single = aggregateItemDemand("rice-basmati", [rice]);
    const doubled = aggregateItemDemand("rice-basmati", [rice, { ...rice }]);
    expect(single.ok && doubled.ok).toBe(true);
    if (!single.ok || !doubled.ok) return;
    expect(doubled.demand).toEqual(single.demand);
  });

  it("missing retailer evidence is an explicit exception, never a guessed SKU or price", () => {
    const { plan } = chain(ledger);
    const basket = aggregateCandidateBasket(plan, {
      catalogue: catalogue.filter((c) => c.itemKey !== "eggs-large"),
      retailer: "Tesco",
    });
    expect(basket.lines.map((l) => l.itemKey)).toEqual(["rice-basmati"]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["eggs-large"]);
    expect(basket.exceptions.map((x) => x.code)).toContain("NO_CATALOGUE_MATCH");
    expect(basket.readyForApproval).toBe(false);
    expect(JSON.stringify(basket)).not.toContain("SKU-EGGS-6");
  });
});

function completion(over: Partial<PlannedMealCompletion> = {}): PlannedMealCompletion {
  return {
    mealId: "MEAL-TUE-DINNER",
    completionId: "CMP-MEAL-TUE-DINNER-1",
    mealPlanId: "PLAN-2026-W37",
    recipeId: "RCP-SALMON-TRAYBAKE",
    mealName: "Salmon traybake",
    plannedFor: "2026-09-08T18:30:00.000Z",
    completedAt: "2026-09-08T19:15:00.000Z",
    state: "COMPLETED",
    ingredients: [{ itemKey: SALMON, quantity: 780, unit: "g" }],
    ...over,
  };
}

describe("meal completion scheduler idempotency", () => {
  it("a duplicate completion signal inside one hourly batch proposes once", () => {
    const run = proposeMealCompletionConsumption([completion(), completion()], { now: NOW });
    expect(run.proposals).toHaveLength(1);
    expect(run.deduped).toHaveLength(1);
    expect(run.deduped[0]!.eventId).toBe(run.proposals[0]!.eventId);
    expect(run.proposals[0]!.preview.wouldWrite).toBe(false);
  });

  it("three consecutive hourly reruns never queue a second event", () => {
    let fingerprints = proposeMealCompletionConsumption([completion()], { now: NOW }).fingerprints;
    for (let hour = 0; hour < 3; hour += 1) {
      const rerun = proposeMealCompletionConsumption([completion()], {
        now: NOW,
        knownProposals: fingerprints,
      });
      expect(rerun.proposals).toHaveLength(0);
      expect(rerun.exceptions).toEqual([]);
      fingerprints = rerun.fingerprints;
    }
    expect(fingerprints).toHaveLength(1);
  });

  it("provenance survives into the canonical row", () => {
    const p = proposeMealCompletionConsumption([completion()], { now: NOW }).proposals[0]!;
    expect(p.mealPlanId).toBe("PLAN-2026-W37");
    expect(p.recipeId).toBe("RCP-SALMON-TRAYBAKE");
    expect(p.record.row.Evidence).toContain("MEAL-TUE-DINNER");
    expect(p.record.row["Quantity delta"]).toBe(-780);
    expect(p.requiresHumanAuthorization).toBe(true);
  });
});
