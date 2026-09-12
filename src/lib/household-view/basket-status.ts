/**
 * FoodOS household basket status — PRESENTATION ONLY.
 *
 * Maps the canonical `CanonicalBasketReadResult` contract into plain-English
 * household wording. It invents no basket, contacts nothing, and never
 * upgrades a NOT_READY result into something actionable.
 */

import type { CanonicalBasketReadResult } from "../procurement/canonical-basket";

export interface HouseholdBasketStatus {
  /** True only when a canonical basket exists and can be reviewed. */
  actionable: boolean;
  /** Short household headline for the surface. */
  headline: string;
  /** Plain-English explanation of the authoritative blocker, if any. */
  blocker: string | null;
  /** Label for the primary basket control. */
  ctaLabel: string;
}

const BLOCKERS: Record<
  Extract<CanonicalBasketReadResult, { status: "NOT_READY" }>["reason"],
  string
> = {
  NO_REVIEWABLE_BASKET:
    "No shopping plan has been produced yet. The most common cause is that planned meals have no serving counts recorded, so FoodOS cannot work out quantities to buy.",
  AMBIGUOUS_REVIEWABLE_BASKETS:
    "More than one shopping plan is open at once. FoodOS will not guess which one you meant.",
  BASKET_PAYLOAD_INVALID:
    "The shopping plan that exists is incomplete, so FoodOS is not showing it as something you can approve.",
  BASKET_NOT_APPROVABLE:
    "The shopping plan is not finished being worked out, so there is nothing safe to approve yet.",
  APPROVAL_PROVENANCE_INVALID:
    "The shopping plan and its approval record do not match exactly, so FoodOS is holding it back.",
  CONNECTOR_NOT_CONFIGURED:
    "FoodOS is not connected to your household's records yet, so it has no real shopping plan to show.",
  CONNECTOR_READ_FAILED:
    "FoodOS could not read your household's records just now, so it is not showing a shopping plan.",
};

export function describeBasketStatus(
  state: CanonicalBasketReadResult | null,
): HouseholdBasketStatus {
  if (state === null) {
    return {
      actionable: false,
      headline: "Checking your shopping plan…",
      blocker: null,
      ctaLabel: "Checking…",
    };
  }

  if (state.status === "READY") {
    return {
      actionable: true,
      headline: "One basket is ready for you to review.",
      blocker: null,
      ctaLabel: "Review basket",
    };
  }

  return {
    actionable: false,
    headline: "No shopping plan is ready.",
    blocker: BLOCKERS[state.reason],
    ctaLabel: "No basket to review",
  };
}

/**
 * The household hero line. It must never claim food is under control on the
 * strength of demo week data when procurement has produced nothing.
 */
export function describeHomeHeadline(state: CanonicalBasketReadResult | null): {
  line1: string;
  line2: string;
} {
  const status = describeBasketStatus(state);
  if (state === null) return { line1: "Your week so far.", line2: "Checking your shopping plan…" };
  if (status.actionable) {
    return { line1: "Food is under control.", line2: "One basket left to review." };
  }
  return { line1: "Your week so far.", line2: "No shopping plan is ready yet." };
}
