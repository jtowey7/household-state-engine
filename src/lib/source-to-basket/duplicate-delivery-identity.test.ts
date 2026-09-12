/**
 * RED-TEAM: materialised-state identity vs evidence identity.
 *
 * Invariant under test: replaying the same logical event ledger with an
 * identical duplicate delivery must NOT change the materialised-state identity
 * used downstream (snapshotId -> planId -> basketId -> approval fingerprint).
 * The duplicate must still be visible as reconciliation/audit evidence.
 *
 * Plus procurement reliability: identical requirements submitted twice
 * aggregate idempotently, and missing retailer catalogue evidence produces an
 * explicit unsourceable exception with no guessed SKU or price.
 *
 * SYNTHETIC fixtures only. No Airtable, no production state, no dispatch.
 */
import { describe, expect, it } from "vitest";

import { runReplayToQuantityIntegration } from "../test-lab/harness";
import { aggregateCandidateBasket, aggregateItemDemand } from "../procurement/adapter";
import { basketApprovalFingerprint } from "../procurement/approval";
import type { CatalogueEntry } from "../procurement/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type { HouseholdEvent } from "../state-engine/types";

const NOW = () => "2026-09-12T00:00:00.000Z";

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

const delivery: HouseholdEvent = {
  eventId: "EVT-DELIVERY-EGGS",
  eventType: "ITEM_STOCK_DELTA",
  itemKey: "eggs-large",
  occurredAt: "2026-09-11T08:00:00.000Z",
  recordClass: "Production",
  payload: { quantity: 6, unit: "count", note: "Delivery" },
};

const ledger: HouseholdEvent[] = [
  delivery,
  {
    eventId: "EVT-DELIVERY-RICE",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "rice-basmati",
    occurredAt: "2026-09-11T08:00:00.000Z",
    recordClass: "Production",
    payload: { quantity: 1000, unit: "g", note: "Delivery" },
  },
];

const chain = (events: readonly HouseholdEvent[]) => {
  const run = runReplayToQuantityIntegration(events, { targets, now: NOW });
  const basket = aggregateCandidateBasket(run.plan, { catalogue, retailer: "Tesco" });
  return { run, basket, approval: basketApprovalFingerprint(basket) };
};

describe("duplicate delivery: materialised identity is stable, evidence still records it", () => {
  const once = chain(ledger);
  const twice = chain([...ledger, { ...delivery }]);

  it("materialised quantity is unchanged", () => {
    expect(twice.run.snapshot.items.find((i) => i.itemKey === "eggs-large")?.quantity).toBe(
      once.run.snapshot.items.find((i) => i.itemKey === "eggs-large")?.quantity,
    );
  });

  it("snapshot and replay identity are unchanged", () => {
    expect(twice.run.snapshotId).toBe(once.run.snapshotId);
    expect(twice.run.replayId).toBe(once.run.replayId);
  });

  it("downstream plan, basket and approval identity are unchanged", () => {
    expect(twice.run.plan.planId).toBe(once.run.plan.planId);
    expect(twice.run.plan.requirements).toEqual(once.run.plan.requirements);
    expect(twice.basket.basketId).toBe(once.basket.basketId);
    expect(twice.approval).toBe(once.approval);
  });

  it("the duplicate is still visible as reconciliation evidence, separately from state identity", () => {
    expect(once.run.snapshot.exceptions.map((x) => x.code)).toEqual([]);
    expect(twice.run.snapshot.exceptions.map((x) => x.code)).toEqual(["DUPLICATE_EVENT_IGNORED"]);
    expect(twice.run.snapshot.ignoredEventIds).toEqual(["EVT-DELIVERY-EGGS"]);
    expect(twice.run.snapshot.reconciliationStatus).toBe("EXCEPTIONS");
    // Evidence status must not silently downgrade downstream eligibility.
    expect(twice.run.plan.eligibleForProcurement).toBe(true);
  });

  it("a reused Event ID with a CHANGED payload does change identity and blocks", () => {
    const conflicted = chain([
      ...ledger,
      { ...delivery, payload: { quantity: 12, unit: "count", note: "Delivery" } },
    ]);
    expect(conflicted.run.snapshotId).not.toBe(once.run.snapshotId);
    expect(conflicted.run.reconciliationStatus).toBe("BLOCKED");
    expect(conflicted.basket.lines).toEqual([]);
    expect(conflicted.basket.requiresHumanApproval).toBe(true);
  });
});

describe("procurement reliability", () => {
  it("the same requirement submitted twice aggregates idempotently", () => {
    const { run } = chain(ledger);
    const eggs = run.plan.requirements.find((r) => r.itemKey === "eggs-large")!;
    const single = aggregateItemDemand("eggs-large", [eggs]);
    const doubled = aggregateItemDemand("eggs-large", [eggs, { ...eggs }]);
    expect(single.ok && doubled.ok).toBe(true);
    if (!single.ok || !doubled.ok) return;
    expect(doubled.demand).toEqual(single.demand);
  });

  it("re-running procurement on the same plan yields a byte-identical basket", () => {
    const { run, basket } = chain(ledger);
    const again = aggregateCandidateBasket(run.plan, { catalogue, retailer: "Tesco" });
    expect(again).toEqual(basket);
  });

  it("missing catalogue evidence is an explicit unsourceable exception with no guessed SKU/price", () => {
    const { run } = chain(ledger);
    const basket = aggregateCandidateBasket(run.plan, {
      catalogue: catalogue.filter((c) => c.itemKey !== "rice-basmati"),
      retailer: "Tesco",
    });
    expect(basket.lines.map((l) => l.itemKey)).toEqual(["eggs-large"]);
    expect(basket.coverage.unsourcedItemKeys).toEqual(["rice-basmati"]);
    expect(basket.exceptions.map((x) => x.code)).toContain("NO_CATALOGUE_MATCH");
    expect(basket.exceptions.every((x) => !x.fatal)).toBe(true);
    expect(basket.coverage.complete).toBe(false);
    expect(basket.readyForApproval).toBe(false);
    expect(basket.totalCost).toBe(
      basket.lines.reduce((sum, l) => sum + l.lineCost, 0),
    );
  });
});
