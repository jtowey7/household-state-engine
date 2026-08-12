/**
 * Food OS — aggregated procurement -> candidate basket (shadow only).
 *
 * Accepts ONLY a QuantityRunPlan produced by the quantity adapter, matches each
 * requirement against a synthetic retailer catalogue and emits a deterministic
 * candidate basket. It never dispatches, never writes household state, and
 * always requires human approval.
 */

import type { QuantityRunPlan } from "../quantity-adapter/types";

export interface CatalogueEntry {
  itemKey: string;
  sku: string;
  productName: string;
  retailer: string;
  packSize: number;
  packUnit: string;
  /** Price per pack, in minor-unit-safe decimal. */
  packPrice: number;
}

export type ProcurementExceptionCode =
  | "PLAN_NOT_ELIGIBLE"
  | "NO_CATALOGUE_MATCH"
  | "PACK_UNIT_MISMATCH"
  | "NON_POSITIVE_REQUIREMENT";

export interface ProcurementException {
  code: ProcurementExceptionCode;
  itemKey: string | null;
  detail: string;
  /** Fatal exceptions mean no basket at all; otherwise only that line drops. */
  fatal: boolean;
}

export interface BasketLine {
  itemKey: string;
  sku: string;
  productName: string;
  retailer: string;
  requiredQuantity: number;
  unit: string;
  packSize: number;
  packUnit: string;
  packCount: number;
  /** packCount * packSize — what would actually arrive. */
  orderedQuantity: number;
  lineCost: number;
  /** Provenance carried unbroken from the replayed household events. */
  sourceEventIds: string[];
}

export interface CandidateBasket {
  basketId: string;
  planId: string;
  snapshotId: string;
  replayId: string;
  replayTimestamp: string;
  retailer: string | null;
  lines: BasketLine[];
  exceptions: ProcurementException[];
  totalCost: number;
  /** True only when a human has something coherent to review. */
  readyForReview: boolean;
  readonly dispatched: false;
  readonly requiresHumanApproval: true;
}

export interface ProcurementOptions {
  catalogue: readonly CatalogueEntry[];
  /** Restricts the basket to one retailer. */
  retailer?: string;
}
