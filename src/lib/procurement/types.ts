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
  /** Direct purchasable product URL, when supplied by the catalogue source. */
  productUrl?: string;
}

export type ProcurementExceptionCode =
  | "PLAN_NOT_ELIGIBLE"
  | "NO_CATALOGUE_MATCH"
  | "PACK_UNIT_MISMATCH"
  | "INVALID_CATALOGUE_ENTRY"
  | "NON_POSITIVE_REQUIREMENT"
  /** Blank/whitespace demand identity is never allowed to source a basket line. */
  | "INVALID_DEMAND_ITEM_KEY"
  /** Multiple valid retailers exist without explicit basket scope. */
  | "RETAILER_SCOPE_REQUIRED"
  /** A valid demand/catalogue pair would overflow pack-count or price arithmetic. */
  | "PACK_CALCULATION_OVERFLOW"
  /** Basket line costs are individually finite but their aggregate is not representable. */
  | "TOTAL_COST_OVERFLOW"
  /** Same item demanded twice in incompatible units; never converted. */
  | "DUPLICATE_REQUIREMENT_UNIT_CONFLICT"
  /** Same requirement ID was reused with a changed canonical requirement payload. */
  | "DUPLICATE_REQUIREMENT_ID_CONFLICT"
  /** One catalogue SKU is reused for the same item with conflicting product payloads. */
  | "CATALOGUE_SKU_CONFLICT"
  /** A Family Alpha basket requested direct product links but the matched catalogue entry lacks one. */
  | "MISSING_PRODUCT_URL";

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
  /** Direct purchasable product URL carried from the matched catalogue entry. */
  productUrl?: string;
  /** Provenance carried unbroken from the replayed household events. */
  sourceEventIds: string[];
  /** Quantity requirement identities aggregated into this single line. */
  requirementIds: string[];
  /** How many source requirements were folded into this line. */
  requirementCount: number;
}

/**
 * Explicit coverage report. A basket is only `complete` when every demanded
 * item became a sourced line; an item with no verified product source is never
 * reported as covered.
 */
export interface BasketCoverage {
  demandItemKeys: string[];
  sourcedItemKeys: string[];
  /** Demanded, but with no valid/compatible product source. */
  unsourcedItemKeys: string[];
  complete: boolean;
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
  coverage: BasketCoverage;
  /** True only when every demanded item is sourced. Mirrors `coverage.complete`. */
  complete: boolean;
  /** True only when a human has something coherent to review. */
  readyForReview: boolean;
  /**
   * True only for a complete basket. A partial basket stays reviewable but
   * must never cross an approval/dispatch boundary as if it were complete.
   */
  readyForApproval: boolean;
  readonly dispatched: false;
  readonly requiresHumanApproval: true;
}

export interface ProcurementOptions {
  catalogue: readonly CatalogueEntry[];
  /** Restricts the basket to one retailer. When omitted, catalogue scope must contain exactly one valid retailer. */
  retailer?: string;
  /** When true, every sourced line must carry a direct product URL from the catalogue. */
  requireProductLinks?: boolean;
}
