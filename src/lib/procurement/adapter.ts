import { hashOf } from "../state-engine/hash";
import type { QuantityRunPlan } from "../quantity-adapter/types";
import type {
  BasketLine,
  CandidateBasket,
  CatalogueEntry,
  ProcurementException,
  ProcurementOptions,
} from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Deterministic catalogue pick: cheapest per unit, ties broken by sku order. */
function pickEntry(entries: CatalogueEntry[]): CatalogueEntry {
  return [...entries].sort((a, b) => {
    const ua = a.packPrice / a.packSize;
    const ub = b.packPrice / b.packSize;
    if (ua !== ub) return ua - ub;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  })[0]!;
}

/**
 * Aggregates a quantity plan into one deterministic candidate basket.
 * Pure: no I/O, no writes, no dispatch.
 */
export function aggregateCandidateBasket(
  plan: QuantityRunPlan | null | undefined,
  options: ProcurementOptions,
): CandidateBasket {
  const exceptions: ProcurementException[] = [];
  const empty = (reason: string): CandidateBasket => {
    exceptions.unshift({
      code: "PLAN_NOT_ELIGIBLE",
      itemKey: null,
      detail: reason,
      fatal: true,
    });
    return {
      basketId: hashOf({ refused: reason }),
      planId: plan?.planId ?? "",
      snapshotId: plan?.snapshotId ?? "",
      replayId: plan?.replayId ?? "",
      replayTimestamp: plan?.replayTimestamp ?? "",
      retailer: options.retailer ?? null,
      lines: [],
      exceptions,
      totalCost: 0,
      readyForReview: false,
      dispatched: false,
      requiresHumanApproval: true,
    };
  };

  if (!plan) return empty("No quantity plan supplied; procurement refuses to invent demand.");
  if (!plan.executed || !plan.eligibleForProcurement) {
    return empty(
      `Quantity plan is not eligible for procurement (status ${plan.reconciliationStatus}); no basket built.`,
    );
  }

  const byItem = new Map<string, CatalogueEntry[]>();
  for (const entry of options.catalogue) {
    if (options.retailer && entry.retailer !== options.retailer) continue;
    const rows = byItem.get(entry.itemKey) ?? [];
    rows.push(entry);
    byItem.set(entry.itemKey, rows);
  }

  const lines: BasketLine[] = [];
  for (const requirement of plan.requirements) {
    if (!(requirement.requiredQuantity > 0)) {
      exceptions.push({
        code: "NON_POSITIVE_REQUIREMENT",
        itemKey: requirement.itemKey,
        detail: `Requirement of ${requirement.requiredQuantity} ${requirement.unit} is not procurable.`,
        fatal: false,
      });
      continue;
    }
    const candidates = byItem.get(requirement.itemKey);
    if (!candidates || candidates.length === 0) {
      exceptions.push({
        code: "NO_CATALOGUE_MATCH",
        itemKey: requirement.itemKey,
        detail: `No catalogue product for "${requirement.itemKey}"; line withheld for human sourcing.`,
        fatal: false,
      });
      continue;
    }
    const entry = pickEntry(candidates);
    if (entry.packUnit !== requirement.unit) {
      exceptions.push({
        code: "PACK_UNIT_MISMATCH",
        itemKey: requirement.itemKey,
        detail: `Requirement in "${requirement.unit}" cannot be filled by a pack measured in "${entry.packUnit}".`,
        fatal: false,
      });
      continue;
    }
    const packCount = Math.max(1, Math.ceil(requirement.requiredQuantity / entry.packSize));
    lines.push({
      itemKey: requirement.itemKey,
      sku: entry.sku,
      productName: entry.productName,
      retailer: entry.retailer,
      requiredQuantity: requirement.requiredQuantity,
      unit: requirement.unit,
      packSize: entry.packSize,
      packUnit: entry.packUnit,
      packCount,
      orderedQuantity: round2(packCount * entry.packSize),
      lineCost: round2(packCount * entry.packPrice),
      sourceEventIds: [...requirement.sourceEventIds],
    });
  }

  lines.sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const totalCost = round2(lines.reduce((sum, l) => sum + l.lineCost, 0));

  return {
    basketId: hashOf({
      planId: plan.planId,
      snapshotId: plan.snapshotId,
      retailer: options.retailer ?? null,
      lines: lines.map((l) => [l.itemKey, l.sku, l.packCount, l.lineCost]),
    }),
    planId: plan.planId,
    snapshotId: plan.snapshotId,
    replayId: plan.replayId,
    replayTimestamp: plan.replayTimestamp,
    retailer: options.retailer ?? null,
    lines,
    exceptions,
    totalCost,
    readyForReview: lines.length > 0,
    dispatched: false,
    requiresHumanApproval: true,
  };
}
