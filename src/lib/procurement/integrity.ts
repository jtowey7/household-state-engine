import type { CandidateBasket } from "./types";

export type BasketIntegrityCode =
  | "COVERAGE_FLAG_MISMATCH"
  | "COVERAGE_OUTSIDE_DEMAND"
  | "SOURCED_COVERAGE_OUTSIDE_DEMAND"
  | "UNSOURCED_COVERAGE_OUTSIDE_DEMAND"
  | "DUPLICATE_DEMAND_COVERAGE"
  | "DUPLICATE_SOURCED_COVERAGE"
  | "DUPLICATE_UNSOURCED_COVERAGE"
  | "COMPLETE_COVERAGE_COUNT_MISMATCH"
  | "LINE_NOT_IN_SOURCED_COVERAGE"
  | "DUPLICATE_ITEM_LINES"
  | "INVALID_TOTAL_COST"
  | "TOTAL_COST_MISMATCH"
  | "LINE_MISSING_PROVENANCE"
  | "INVALID_LINE_ARITHMETIC";

export interface BasketIntegrityFinding {
  code: BasketIntegrityCode;
  itemKey: string | null;
  detail: string;
}

/**
 * Deterministic Basket Phase 4 structural integrity gate.
 *
 * This validates the internal consistency of a candidate basket without
 * judging its economic desirability, approving it, purchasing it or mutating
 * household state. Incomplete demand coverage is allowed here because that is
 * a legitimate Phase 5 review condition; contradictory coverage is not.
 */
export function validateBasketIntegrity(
  basket: CandidateBasket,
): BasketIntegrityFinding[] {
  const findings: BasketIntegrityFinding[] = [];
  const demandedKeys = new Set(basket.coverage.demandItemKeys);
  const sourcedKeys = new Set(basket.coverage.sourcedItemKeys);
  const unsourcedKeys = new Set(basket.coverage.unsourcedItemKeys);
  const coveredKeys = new Set([...sourcedKeys, ...unsourcedKeys]);
  const lineKeys = new Set(basket.lines.map((line) => line.itemKey));

  const duplicateKeys = (keys: string[]): string[] =>
    [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].sort();

  for (const itemKey of duplicateKeys(basket.coverage.demandItemKeys)) {
    findings.push({
      code: "DUPLICATE_DEMAND_COVERAGE",
      itemKey,
      detail: `Basket demand coverage contains duplicate item key "${itemKey}".`,
    });
  }

  for (const itemKey of duplicateKeys(basket.coverage.sourcedItemKeys)) {
    findings.push({
      code: "DUPLICATE_SOURCED_COVERAGE",
      itemKey,
      detail: `Basket sourced coverage contains duplicate item key "${itemKey}".`,
    });
  }

  for (const itemKey of duplicateKeys(basket.coverage.unsourcedItemKeys)) {
    findings.push({
      code: "DUPLICATE_UNSOURCED_COVERAGE",
      itemKey,
      detail: `Basket unsourced coverage contains duplicate item key "${itemKey}".`,
    });
  }

  if (basket.coverage.complete !== basket.complete) {
    findings.push({
      code: "COVERAGE_FLAG_MISMATCH",
      itemKey: null,
      detail: "Basket coverage completion flag does not match basket completion.",
    });
  }

  for (const itemKey of [...coveredKeys].sort()) {
    if (!demandedKeys.has(itemKey)) {
      findings.push({
        code: "COVERAGE_OUTSIDE_DEMAND",
        itemKey,
        detail: "Basket coverage contains an item that is not present in demand.",
      });
    }
  }

  for (const itemKey of [...sourcedKeys].sort()) {
    if (!demandedKeys.has(itemKey)) {
      findings.push({
        code: "SOURCED_COVERAGE_OUTSIDE_DEMAND",
        itemKey,
        detail: "Basket coverage sources an item that is not present in demand.",
      });
    }
  }

  for (const itemKey of [...unsourcedKeys].sort()) {
    if (!demandedKeys.has(itemKey)) {
      findings.push({
        code: "UNSOURCED_COVERAGE_OUTSIDE_DEMAND",
        itemKey,
        detail: "Basket coverage marks an item unsourced that is not present in demand.",
      });
    }
  }

  if (basket.complete && demandedKeys.size !== sourcedKeys.size) {
    findings.push({
      code: "COMPLETE_COVERAGE_COUNT_MISMATCH",
      itemKey: null,
      detail: "Complete basket does not have one sourced coverage entry for every demanded item.",
    });
  }

  for (const itemKey of [...lineKeys].sort()) {
    if (!sourcedKeys.has(itemKey)) {
      findings.push({
        code: "LINE_NOT_IN_SOURCED_COVERAGE",
        itemKey,
        detail: "Basket contains a line that is not represented in sourced coverage.",
      });
    }
  }

  const duplicateLineKeys = basket.lines
    .map((line) => line.itemKey)
    .filter((itemKey, index, keys) => keys.indexOf(itemKey) !== index);
  for (const itemKey of [...new Set(duplicateLineKeys)].sort()) {
    findings.push({
      code: "DUPLICATE_ITEM_LINES",
      itemKey,
      detail: "Basket contains duplicate item lines.",
    });
  }

  const lineTotal = basket.lines.reduce((sum, line) => sum + line.lineCost, 0);
  if (!Number.isFinite(basket.totalCost) || basket.totalCost < 0) {
    findings.push({
      code: "INVALID_TOTAL_COST",
      itemKey: null,
      detail: "Basket has invalid total-cost arithmetic.",
    });
  } else if (!Number.isFinite(lineTotal) || Math.abs(lineTotal - basket.totalCost) > 0.005) {
    findings.push({
      code: "TOTAL_COST_MISMATCH",
      itemKey: null,
      detail: "Basket total does not reconcile to its line costs.",
    });
  }

  for (const line of basket.lines) {
    if (line.sourceEventIds.length === 0) {
      findings.push({
        code: "LINE_MISSING_PROVENANCE",
        itemKey: line.itemKey,
        detail: `Line "${line.itemKey}" has no source event provenance.`,
      });
    }

    if (
      !Number.isFinite(line.requiredQuantity) ||
      line.requiredQuantity <= 0 ||
      !Number.isFinite(line.packSize) ||
      line.packSize <= 0 ||
      !Number.isFinite(line.packCount) ||
      !Number.isFinite(line.orderedQuantity) ||
      line.orderedQuantity <= 0 ||
      line.orderedQuantity < line.requiredQuantity ||
      line.packUnit !== line.unit ||
      !Number.isFinite(line.lineCost) ||
      line.packCount < 1 ||
      line.lineCost < 0
    ) {
      findings.push({
        code: "INVALID_LINE_ARITHMETIC",
        itemKey: line.itemKey,
        detail: `Line "${line.itemKey}" has invalid pack, quantity or cost arithmetic.`,
      });
    }
  }

  return findings;
}
