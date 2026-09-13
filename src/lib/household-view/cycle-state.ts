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
  | "NEEDS_CONNECTION"
  | "SHOP_TO_REVIEW"
  | "SHOP_ON_ITS_WAY"
  | "DELIVERY_TO_CONFIRM"
  | "ALL_SETTLED";

export interface CycleAction {
  label: string;
  to: "/shop" | "/delivery" | "/food";
}

export interface CycleView {
  stage: CycleStage;
  /** Plain-language shopping line. */
  shopping: string;
  /** Plain-language delivery line. */
  delivery: string;
  /** Calm tone only when receipt is proven. */
  tone: "good" | "attention" | "neutral";
  action: CycleAction;
}

export interface CycleInput {
  /** True when a shop exists that the household can look at. */
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
}

export function describeCycle(input: CycleInput): CycleView {
  if (input.receiptConfirmed) {
    return {
      stage: "ALL_SETTLED",
      shopping: "This week's shop is done.",
      delivery: "Everything that came has been counted in.",
      tone: "good",
      action: { label: "Update what's at home", to: "/food" },
    };
  }

  if (input.deliveryApproved || (input.deliveryKnown && input.shopApproved)) {
    return {
      stage: "DELIVERY_TO_CONFIRM",
      shopping: "Your shop is agreed, but it is not counted as food at home.",
      delivery: "Has it arrived? Confirm what came before anything is counted in.",
      tone: "attention",
      action: { label: "Confirm the delivery", to: "/delivery" },
    };
  }

  if (input.shopApproved) {
    return {
      stage: "SHOP_ON_ITS_WAY",
      shopping: "Your shop is agreed.",
      delivery: "Not counted as food at home until you confirm what arrived.",
      tone: "attention",
      action: { label: "Confirm the delivery", to: "/delivery" },
    };
  }

  if (input.shopReady) {
    return {
      stage: "SHOP_TO_REVIEW",
      shopping: "There's a shop waiting for you to look at.",
      delivery: "Nothing on its way yet.",
      tone: "attention",
      action: { label: "Review this week's shop", to: "/shop" },
    };
  }

  return {
    stage: "NEEDS_CONNECTION",
    shopping: "No shop is ready to look at yet.",
    delivery: "Nothing on its way yet.",
    tone: "neutral",
    action: { label: "Review this week's shop", to: "/shop" },
  };
}
