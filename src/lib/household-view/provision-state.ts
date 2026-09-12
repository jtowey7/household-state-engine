/**
 * FoodOS household provision state — PRESENTATION ONLY.
 *
 * Maps the canonical basket read result plus the week's plain coverage counts
 * into the household-facing state transition:
 *
 *   plentiful          -> meal-led and reassuring, nothing to do
 *   replenish soon     -> shopping surfaces naturally
 *   shop unconfirmed   -> a plain-language recovery choice instead of an
 *                         internal status label ("Not ready" / "Approved")
 *
 * It invents no household facts, contacts nothing, and never upgrades a
 * NOT_READY canonical result into something actionable.
 */

import type { CanonicalBasketReadResult } from "../procurement/canonical-basket";

export type ProvisionState =
  | "CHECKING"
  | "PLENTIFUL"
  | "REPLENISH_SOON"
  | "SHOP_UNCONFIRMED";

export interface ProvisionChoice {
  label: string;
  /** Existing household route. */
  to: "/shop" | "/week" | "/sweep" | "/food";
}

export interface HouseholdProvision {
  state: ProvisionState;
  /** Hero line one — what is true right now. */
  line1: string;
  /** Hero line two — what it means for the household. */
  line2: string;
  /** The single obvious next move, if there is one. */
  primary: ProvisionChoice | null;
  /** The always-available alternative. */
  secondary: ProvisionChoice | null;
  /** Household wording for the shopping section heading. */
  shoppingHeading: string;
  /** Household wording for the shopping section body when nothing is ready. */
  shoppingBody: string;
}

export interface ProvisionInput {
  basket: CanonicalBasketReadResult | null;
  /** Days this week whose ingredients are not covered by what is in. */
  daysNeedingShopping: number;
  /** An item the household still has to settle, if any. */
  uncertainItemLabel?: string | null;
}

export function describeProvision(input: ProvisionInput): HouseholdProvision {
  const { basket, daysNeedingShopping } = input;
  const uncertain = input.uncertainItemLabel ?? null;

  if (basket === null) {
    return {
      state: "CHECKING",
      line1: "Looking at your week.",
      line2: "One moment.",
      primary: null,
      secondary: { label: "See the week", to: "/week" },
      shoppingHeading: "Your shopping",
      shoppingBody: "Checking what you need.",
    };
  }

  if (basket.status === "READY") {
    const count = basket.basket.lines.length;
    return {
      state: "REPLENISH_SOON",
      line1: "Time for a shop.",
      line2:
        count > 0
          ? `${count} things to get, worked out from the week.`
          : "The week is worked out and a shop is waiting for you.",
      primary: { label: "Order the shop", to: "/shop" },
      secondary: { label: "Make what we have last", to: "/week" },
      shoppingHeading: "Your shop",
      shoppingBody: "Everything below comes from this week's meals.",
    };
  }

  if (daysNeedingShopping > 0 || uncertain !== null) {
    return {
      state: "SHOP_UNCONFIRMED",
      line1: "The shop isn't confirmed yet.",
      line2: uncertain
        ? `Settling ${uncertain.toLowerCase()} will let foodOS finish the list.`
        : "You can get it ordered, or stretch what's already in.",
      primary: uncertain
        ? { label: `Settle ${uncertain.toLowerCase()}`, to: "/sweep" }
        : { label: "Order the shop", to: "/shop" },
      secondary: { label: "Make what we have last", to: "/week" },
      shoppingHeading: "Two ways forward",
      shoppingBody:
        "Order the shop when you're ready, or make what you have last and foodOS will re-plan around it.",
    };
  }

  return {
    state: "PLENTIFUL",
    line1: "There's plenty in.",
    line2: "Every meal this week is covered by what you already have.",
    primary: { label: "See the week", to: "/week" },
    secondary: { label: "What you have", to: "/food" },
    shoppingHeading: "Nothing to buy",
    shoppingBody: "The week is covered. foodOS will tell you when a shop is worth doing.",
  };
}
