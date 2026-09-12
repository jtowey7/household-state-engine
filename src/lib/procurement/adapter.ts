import { hashOf } from "../state-engine/hash";
import type { QuantityRequirement, QuantityRunPlan } from "../quantity-adapter/types";
import type {
  BasketCoverage,
  BasketLine,
  CandidateBasket,
  CatalogueEntry,
  ProcurementException,
  ProcurementOptions,
} from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidProductUrl(
  url: string | undefined,
  allowedHosts: readonly string[] = [],
  retailer?: string,
  retailerHosts: Readonly<Record<string, readonly string[]>> = {},
): boolean {
  if (url === undefined || url.trim().length === 0 || allowedHosts.length === 0) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!allowedHosts.some((host) => hostname === host.trim().toLowerCase())) return false;
    if (parsed.pathname === "/") return false;
    if (retailer !== undefined) {
      const boundHosts = retailerHosts[retailer] ?? [];
      if (!boundHosts.some((host) => hostname === host.trim().toLowerCase())) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isValidCatalogueEntry(
  entry: CatalogueEntry,
  requireProductLinks = false,
  productUrlHostAllowlist: readonly string[] = [],
  productUrlRetailerHosts: Readonly<Record<string, readonly string[]>> = {},
  retailerScope?: string,
): boolean {
  return (
    entry.sku.trim().length > 0 &&
    entry.productName.trim().length > 0 &&
    entry.retailer.trim().length > 0 &&
    Number.isFinite(entry.packSize) &&
    entry.packSize > 0 &&
    Number.isFinite(entry.packPrice) &&
    entry.packPrice >= 0 &&
    entry.packUnit.trim().length > 0 &&
    (!requireProductLinks || isValidProductUrl(entry.productUrl, productUrlHostAllowlist, retailerScope, productUrlRetailerHosts))
  );
}

function catalogueEntryIdentity(entry: CatalogueEntry): string {
  return hashOf({
    sku: entry.sku,
    productName: entry.productName,
    retailer: entry.retailer,
    packSize: entry.packSize,
    packUnit: entry.packUnit,
    packPrice: entry.packPrice,
    productUrl: entry.productUrl ?? null,
  });
}

/** Deterministic catalogue pick: lowest total purchase cost for this demand, then least overage, then unit price, then sku. */
function pickEntry(entries: CatalogueEntry[], requiredQuantity: number): CatalogueEntry {
  return [...entries].sort((a, b) => {
    const aPackCount = Math.max(1, Math.ceil(requiredQuantity / a.packSize));
    const bPackCount = Math.max(1, Math.ceil(requiredQuantity / b.packSize));
    const aCost = aPackCount * a.packPrice;
    const bCost = bPackCount * b.packPrice;
    if (aCost !== bCost) return aCost - bCost;

    const aOverage = aPackCount * a.packSize - requiredQuantity;
    const bOverage = bPackCount * b.packSize - requiredQuantity;
    if (aOverage !== bOverage) return aOverage - bOverage;

    const ua = a.packPrice / a.packSize;
    const ub = b.packPrice / b.packSize;
    if (ua !== ub) return ua - ub;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  })[0]!;
}

/** Canonical payload of a requirement, deliberately excluding its supplied identity. */
function requirementPayloadIdentity(requirement: QuantityRequirement): string {
  return hashOf({
    itemKey: requirement.itemKey,
    unit: requirement.unit,
    requiredQuantity: requirement.requiredQuantity,
    onHandQuantity: requirement.onHandQuantity,
    targetQuantity: requirement.targetQuantity,
    sourceEventIds: [...requirement.sourceEventIds].sort(),
    packSize: requirement.packSize,
  });
}

/** Stable identity of one requirement line, derived when none is supplied. */
export function requirementIdentity(requirement: QuantityRequirement): string {
  return (
    requirement.requirementId ??
    requirementPayloadIdentity(requirement)
  );
}

export interface AggregatedDemand {
  itemKey: string;
  unit: string;
  requiredQuantity: number;
  requirementIds: string[];
  sourceEventIds: string[];
}

export type DemandAggregation =
  | { ok: true; demand: AggregatedDemand }
  | { ok: false; code: ProcurementException["code"]; detail: string };

export function aggregateItemDemand(
  itemKey: string,
  requirements: readonly QuantityRequirement[],
): DemandAggregation {
  let unit: string | null = null;
  let total = 0;
  const requirementIds: string[] = [];
  const sourceEventIds: string[] = [];
  const seenRequirementPayloads = new Map<string, string>();

  for (const requirement of requirements) {
    if (!Number.isFinite(requirement.requiredQuantity) || !(requirement.requiredQuantity > 0)) {
      return {
        ok: false,
        code: "NON_POSITIVE_REQUIREMENT",
        detail: `Requirement for "${itemKey}" has a non-positive or non-finite quantity (${requirement.requiredQuantity}); procurement withholds the item.`,
      };
    }
    const id = requirementIdentity(requirement);
    const payloadIdentity = requirementPayloadIdentity(requirement);
    const priorPayloadIdentity = seenRequirementPayloads.get(id);
    if (priorPayloadIdentity !== undefined) {
      if (priorPayloadIdentity !== payloadIdentity) {
        return {
          ok: false,
          code: "DUPLICATE_REQUIREMENT_ID_CONFLICT",
          detail: `Requirement ID "${id}" was reused for "${itemKey}" with a changed payload; procurement withholds the item.`,
        };
      }
      continue;
    }
    seenRequirementPayloads.set(id, payloadIdentity);
    if (unit === null) unit = requirement.unit;
    else if (unit !== requirement.unit) {
      return {
        ok: false,
        code: "DUPLICATE_REQUIREMENT_UNIT_CONFLICT",
        detail: `"${itemKey}" is demanded in both "${unit}" and "${requirement.unit}"; procurement refuses to convert units and withholds the item.`,
      };
    }
    requirementIds.push(id);
    for (const eventId of requirement.sourceEventIds) {
      if (!sourceEventIds.includes(eventId)) sourceEventIds.push(eventId);
    }
    total += requirement.requiredQuantity;
  }
  if (unit === null) return { ok: false, code: "NON_POSITIVE_REQUIREMENT", detail: `"${itemKey}" has no requirement lines.` };
  if (!Number.isFinite(total) || !(total > 0)) {
    return { ok: false, code: "NON_POSITIVE_REQUIREMENT", detail: `Requirement of ${total} ${unit} is not procurable.` };
  }
  return { ok: true, demand: { itemKey, unit, requiredQuantity: round2(total), requirementIds, sourceEventIds } };
}

export function aggregateCandidateBasket(
  plan: QuantityRunPlan | null | undefined,
  options: ProcurementOptions,
): CandidateBasket {
  const exceptions: ProcurementException[] = [];
  const requireProductLinks = options.requireProductLinks === true;
  const productUrlHostAllowlist = options.productUrlHostAllowlist ?? [];
  const productUrlRetailerHosts = options.productUrlRetailerHosts ?? {};
  const empty = (reason: string): CandidateBasket => {
    exceptions.unshift({ code: "PLAN_NOT_ELIGIBLE", itemKey: null, detail: reason, fatal: true });
    return {
      basketId: hashOf({ refused: reason }), planId: plan?.planId ?? "", snapshotId: plan?.snapshotId ?? "", replayId: plan?.replayId ?? "", replayTimestamp: plan?.replayTimestamp ?? "",
      retailer: options.retailer ?? null, lines: [], exceptions, totalCost: 0,
      coverage: { demandItemKeys: [], sourcedItemKeys: [], unsourcedItemKeys: [], complete: false },
      complete: false, readyForReview: false, readyForApproval: false, dispatched: false, requiresHumanApproval: true,
    };
  };
  if (!plan) return empty("No quantity plan supplied; procurement refuses to invent demand.");
  if (!plan.executed || !plan.eligibleForProcurement) return empty(`Quantity plan is not eligible for procurement (status ${plan.reconciliationStatus}); no basket built.`);

  const validCatalogueRetailers = [...new Set(options.catalogue.filter((entry) => isValidCatalogueEntry(entry, requireProductLinks, productUrlHostAllowlist, productUrlRetailerHosts)).map((entry) => entry.retailer))].sort();
  if (options.retailer === undefined && validCatalogueRetailers.length > 1) {
    const reason = `Catalogue contains multiple retailers (${validCatalogueRetailers.join(", ")}) but no retailer scope was supplied; procurement refuses to build a multi-retailer basket.`;
    exceptions.unshift({ code: "RETAILER_SCOPE_REQUIRED", itemKey: null, detail: reason, fatal: true });
    return {
      basketId: hashOf({ refused: reason }), planId: plan.planId, snapshotId: plan.snapshotId, replayId: plan.replayId, replayTimestamp: plan.replayTimestamp,
      retailer: null, lines: [], exceptions, totalCost: 0,
      coverage: { demandItemKeys: [], sourcedItemKeys: [], unsourcedItemKeys: [], complete: false },
      complete: false, readyForReview: false, readyForApproval: false, dispatched: false, requiresHumanApproval: true,
    };
  }
  const retailer = options.retailer ?? validCatalogueRetailers[0] ?? null;

  const byItem = new Map<string, CatalogueEntry[]>();
  for (const entry of options.catalogue) {
    if (retailer !== null && entry.retailer !== retailer) continue;
    const rows = byItem.get(entry.itemKey) ?? [];
    rows.push(entry);
    byItem.set(entry.itemKey, rows);
  }
  const skuIdentities = new Map<string, string>();
  const conflictingSkus = new Set<string>();
  for (const entry of options.catalogue) {
    if (retailer !== null && entry.retailer !== retailer) continue;
    if (!isValidCatalogueEntry(entry, requireProductLinks, productUrlHostAllowlist, productUrlRetailerHosts, retailer ?? undefined)) continue;
    const skuScope = `${entry.retailer}\u0000${entry.sku}`;
    const identity = catalogueEntryIdentity(entry);
    const prior = skuIdentities.get(skuScope);
    if (prior !== undefined && prior !== identity) conflictingSkus.add(skuScope);
    else if (prior === undefined) skuIdentities.set(skuScope, identity);
  }

  const lines: BasketLine[] = [];
  const demandItemKeys: string[] = [];
  const sourcedItemKeys: string[] = [];
  const unsourcedItemKeys: string[] = [];
  const grouped = new Map<string, QuantityRequirement[]>();
  for (const requirement of plan.requirements) grouped.set(requirement.itemKey, [...(grouped.get(requirement.itemKey) ?? []), requirement]);

  for (const itemKey of [...grouped.keys()].sort()) {
    demandItemKeys.push(itemKey);
    const unsourced = (code: ProcurementException["code"], detail: string) => {
      exceptions.push({ code, itemKey, detail, fatal: false });
      unsourcedItemKeys.push(itemKey);
    };
    if (itemKey.trim().length === 0) {
      unsourced("INVALID_DEMAND_ITEM_KEY", "Demand item identity is blank/whitespace; line withheld pending demand-source reconciliation.");
      continue;
    }
    const aggregated = aggregateItemDemand(itemKey, grouped.get(itemKey)!);
    if (!aggregated.ok) { unsourced(aggregated.code, aggregated.detail); continue; }
    const demand = aggregated.demand;
    const candidates = byItem.get(itemKey);
    if (!candidates || candidates.length === 0) { unsourced("NO_CATALOGUE_MATCH", `No catalogue product for "${itemKey}"; line withheld for human sourcing.`); continue; }
    const validCandidates = candidates.filter((candidate) => isValidCatalogueEntry(candidate, requireProductLinks, productUrlHostAllowlist, productUrlRetailerHosts, retailer ?? undefined));
    if (validCandidates.length === 0) {
      if (requireProductLinks && candidates.some((candidate) => isValidCatalogueEntry(candidate, false, productUrlHostAllowlist, productUrlRetailerHosts, retailer ?? undefined) && !isValidProductUrl(candidate.productUrl, productUrlHostAllowlist, retailer ?? undefined, productUrlRetailerHosts))) {
        const hasProductUrl = candidates.some((candidate) => candidate.productUrl !== undefined && candidate.productUrl.trim().length > 0);
        unsourced(hasProductUrl ? "UNVERIFIED_PRODUCT_URL" : "MISSING_PRODUCT_URL", hasProductUrl
          ? `Catalogue products for "${itemKey}" do not have a direct HTTPS product URL on an allowed retailer host; line withheld for human sourcing.`
          : `Catalogue products for "${itemKey}" do not include a verified direct HTTPS product URL; line withheld for human sourcing.`);
      } else {
        unsourced("INVALID_CATALOGUE_ENTRY", `Catalogue products for "${itemKey}" contain no valid positive pack size and non-negative finite pack price; line withheld for human sourcing.`);
      }
      continue;
    }
    const compatibleCandidates = validCandidates.filter((candidate) => candidate.packUnit === demand.unit);
    if (compatibleCandidates.length === 0) { unsourced("PACK_UNIT_MISMATCH", `Requirement in "${demand.unit}" cannot be filled by any valid pack for "${itemKey}".`); continue; }
    const conflictingSku = compatibleCandidates.find((candidate) => conflictingSkus.has(`${candidate.retailer}\u0000${candidate.sku}`))?.sku;
    if (conflictingSku !== undefined) { unsourced("CATALOGUE_SKU_CONFLICT", `Catalogue SKU "${conflictingSku}" is reused within retailer scope with conflicting product payloads; line withheld pending catalogue reconciliation.`); continue; }
    const entry = pickEntry(compatibleCandidates, demand.requiredQuantity);
    const rawPackCount = demand.requiredQuantity / entry.packSize;
    const packCount = Math.max(1, Math.ceil(rawPackCount));
    const orderedQuantity = packCount * entry.packSize;
    const lineCost = packCount * entry.packPrice;
    if (!Number.isFinite(rawPackCount) || !Number.isSafeInteger(packCount) || !Number.isFinite(orderedQuantity) || !Number.isFinite(lineCost)) { unsourced("PACK_CALCULATION_OVERFLOW", `Demand for "${itemKey}" cannot be represented safely as a finite pack count, ordered quantity, or line cost; line withheld.`); continue; }
    sourcedItemKeys.push(itemKey);
    lines.push({ itemKey, sku: entry.sku, productName: entry.productName, retailer: entry.retailer, requiredQuantity: demand.requiredQuantity, unit: demand.unit, packSize: entry.packSize, packUnit: entry.packUnit, packCount, orderedQuantity: round2(orderedQuantity), lineCost: round2(lineCost), ...(entry.productUrl === undefined ? {} : { productUrl: entry.productUrl }), sourceEventIds: [...demand.sourceEventIds], requirementIds: [...demand.requirementIds], requirementCount: demand.requirementIds.length });
  }

  // An item the quantity run withheld (isolated by a replay conflict, or with
  // unusable unit evidence) must never vanish from the shopping evidence: it is
  // demanded but unsourced, so the basket can never report complete coverage.
  for (const rejection of plan.rejections) {
    if (rejection.itemKey === null || rejection.fatal) continue;
    if (rejection.code !== "ITEM_ISOLATED" && rejection.code !== "UNIT_MISMATCH") continue;
    if (demandItemKeys.includes(rejection.itemKey)) continue;
    demandItemKeys.push(rejection.itemKey);
    unsourcedItemKeys.push(rejection.itemKey);
    exceptions.push({
      code: "UPSTREAM_ITEM_WITHHELD",
      itemKey: rejection.itemKey,
      detail: `Quantity run withheld "${rejection.itemKey}" (${rejection.code}): ${rejection.detail} Procurement reports it as demanded but unsourced.`,
      fatal: false,
    });
  }

  const coverage: BasketCoverage = { demandItemKeys: [...demandItemKeys].sort(), sourcedItemKeys: [...sourcedItemKeys].sort(), unsourcedItemKeys: [...unsourcedItemKeys].sort(), complete: demandItemKeys.length > 0 && unsourcedItemKeys.length === 0 };
  lines.sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const totalCost = round2(lines.reduce((sum, l) => sum + l.lineCost, 0));
  const totalCostOverflowed = !Number.isFinite(totalCost);
  if (totalCostOverflowed) exceptions.unshift({ code: "TOTAL_COST_OVERFLOW", itemKey: null, detail: "Basket total cost cannot be represented as a finite number; basket is withheld from approval.", fatal: true });
  return {
    basketId: hashOf({ planId: plan.planId, snapshotId: plan.snapshotId, retailer, lines: lines.map((l) => [l.itemKey, l.sku, l.packCount, l.lineCost, l.productUrl ?? null]), unsourced: coverage.unsourcedItemKeys }),
    planId: plan.planId, snapshotId: plan.snapshotId, replayId: plan.replayId, replayTimestamp: plan.replayTimestamp, retailer, lines, exceptions, totalCost, coverage,
    complete: coverage.complete && !totalCostOverflowed, readyForReview: lines.length > 0 && !totalCostOverflowed, readyForApproval: lines.length > 0 && coverage.complete && !totalCostOverflowed,
    dispatched: false, requiresHumanApproval: true,
  };
}
