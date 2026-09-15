/**
 * FoodOS household cycle state — PRESENTATION ONLY.
 *
 * Household wording for the week surface. The key rule: an approved shop or
 * an approved delivery is NOT evidence that food has physically arrived.
 * The quiet, reassuring state is only reachable when the delivery data
 * explicitly proves the delivery was received and reconciled. Receipt is
 * never inferred from approval, or from a plan or basket existing.
 */

export type CycleStage =
  | "WEEK_NOT_PLANNED"
  | "NEEDS_CONNECTION"
  | "SHOP_BEING_PREPARED"
  | "SHOP_TO_REVIEW"
  | "SHOP_ON_ITS_WAY"
  | "DELIVERY_TO_CONFIRM"
  | "ALL_SETTLED";

export interface CycleAction {
  label: string;
  to: "/shop" | "/delivery" | "/food" | "/plan-week";
}

export interface CycleView {
  stage: CycleStage;
  /** Plain-language shopping line. */
  shopping: string;
  /** Short shopping status word shown on the week surface. */
  shoppingStatus: string;
  /**
   * True only when a complete canonical shop actually exists to open. The week
   * surface must never offer "View" when the Shop surface has nothing to show.
   */
  shopViewable: boolean;
  /** Plain-language delivery line. */
  delivery: string;
  /** Calm tone only when receipt is proven. */
  tone: "good" | "attention" | "neutral";
  action: CycleAction;
}

export interface CycleInput {
  /**
   * True when a complete, traceable canonical shop exists that the Shop
   * surface will actually render. A finished meal plan is NOT this.
   */
  shopReady: boolean;
  /** True when the household has approved the shop. */
  shopApproved: boolean;
  /** True when the delivery-check step is available for this shop. */
  deliveryKnown: boolean;
  /** True when the delivery itself has been approved — NOT proof of arrival. */
  deliveryApproved: boolean;
  /**
   * True ONLY when the delivery data explicitly records that the delivery was
   * received and reconciled against what was ordered.
   */
  receiptConfirmed: boolean;
  /**
   * True when this week's requirements/meal plan exist. On its own this only
   * justifies "being prepared" wording — never "done", and never a View link.
   */
  planExists?: boolean;
}

export function describeCycle(input: CycleInput): CycleView {
  const shopViewable = input.shopReady;

  if (input.receiptConfirmed) {
    return {
      stage: "ALL_SETTLED",
      shopping: shopViewable
        ? "This week's shop is done."
        : "Your shopping has arrived and been counted in.",
      shoppingStatus: "Done",
      shopViewable,
      delivery: "Everything that came has been counted in.",
      tone: "good",
      action: { label: "Update what's at home", to: "/food" },
    };
  }

  if (input.deliveryApproved || (input.deliveryKnown && input.shopApproved)) {
    return {
      stage: "DELIVERY_TO_CONFIRM",
      shopping: "Your shop is agreed, but it is not counted as food at home.",
      shoppingStatus: "Needs you",
      shopViewable,
      delivery: "Has it arrived? Confirm what came before anything is counted in.",
      tone: "attention",
      action: { label: "Confirm the delivery", to: "/delivery" },
    };
  }

  if (input.shopApproved) {
    return {
      stage: "SHOP_ON_ITS_WAY",
      shopping: "Your shop is agreed.",
      shoppingStatus: "Needs you",
      shopViewable,
      delivery: "Not counted as food at home until you confirm what arrived.",
      tone: "attention",
      action: { label: "Confirm the delivery", to: "/delivery" },
    };
  }

  if (input.shopReady) {
    return {
      stage: "SHOP_TO_REVIEW",
      shopping: "There's a shop waiting for you to look at.",
      shoppingStatus: "Needs you",
      shopViewable: true,
      delivery: "Nothing on its way yet.",
      tone: "attention",
      action: { label: "Review this week's shop", to: "/shop" },
    };
  }

  if (input.planExists) {
    return {
      stage: "SHOP_BEING_PREPARED",
      shopping: "Your shopping plan is being worked out. There's nothing to look at yet.",
      shoppingStatus: "Being prepared",
      shopViewable: false,
      delivery: "Nothing on its way yet.",
      tone: "neutral",
      action: { label: "See what's at home", to: "/food" },
    };
  }

  return {
    stage: "WEEK_NOT_PLANNED",
    shopping: "No shop is ready to look at yet.",
    shoppingStatus: "Nothing yet",
    shopViewable: false,
    delivery: "Nothing on its way yet.",
    tone: "neutral",
    action: { label: "Plan this week", to: "/plan-week" },
  };
}

/** A single line from the planned or delivered basket, shown for reconciliation. */
export interface ReconciliationLine {
  itemKey: string;
  quantity: number;
  unit: string;
}

export interface ReconciliationView {
  title: string;
  headline: string;
  body: string;
  tone: "good" | "attention" | "neutral";
  lines: ReconciliationLine[];
  action: { label: string; to: "/delivery" | "/shop" | "/food" } | null;
}

/**
 * Plain-language reconciliation summary for the weekly surface.
 *
 * This is presentation-only and fail-closed: it never treats an approved shop or
 * delivery as proof that food physically arrived. Planned/approved lines are shown
 * as what is due; arrived quantities are only shown when receipt is explicitly
 * proven. Until then the household is told plainly that confirmation is still needed.
 */
export function describeReconciliation(
  input: CycleInput,
  planned: { retailer: string | null; lines: ReconciliationLine[] } | null,
): ReconciliationView {
  if (input.receiptConfirmed) {
    return {
      title: "Reconciliation",
      headline: "Counted in",
      body: "Everything that arrived has been checked against the shop.",
      tone: "good",
      lines: planned?.lines ?? [],
      action: { label: "Update what's at home", to: "/food" },
    };
  }

  if (input.deliveryApproved || (input.deliveryKnown && input.shopApproved)) {
    const count = planned?.lines.length ?? 0;
    return {
      title: "Reconciliation",
      headline: "Not confirmed yet",
      body: `Your shop is agreed${count ? ` — ${count} thing${count === 1 ? "" : "s"} due to arrive` : ""}. FoodOS has not recorded what physically arrived, so nothing is counted as food at home yet.`,
      tone: "attention",
      lines: planned?.lines ?? [],
      action: { label: "Confirm what arrived", to: "/delivery" },
    };
  }

  if (input.shopApproved) {
    return {
      title: "Reconciliation",
      headline: "On its way",
      body: "Your shop is agreed. Nothing can be counted as food at home until it arrives and you confirm what came.",
      tone: "attention",
      lines: planned?.lines ?? [],
      action: { label: "Confirm what arrived", to: "/delivery" },
    };
  }

  if (input.shopReady) {
    const count = planned?.lines.length ?? 0;
    return {
      title: "Reconciliation",
      headline: "Shop still to review",
      body: `Agree the shop first${count ? ` — ${count} thing${count === 1 ? "" : "s"} waiting` : ""}, then you can check what arrived.`,
      tone: "attention",
      lines: planned?.lines ?? [],
      action: { label: "Review the shop", to: "/shop" },
    };
  }

  return {
    title: "Reconciliation",
    headline: "Nothing to check",
    body: "There is no shop or delivery to reconcile yet.",
    tone: "neutral",
    lines: [],
    action: null,
  };
}

