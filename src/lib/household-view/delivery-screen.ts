/**
 * FoodOS delivery screen wording — PRESENTATION ONLY.
 *
 * Product rule: a routine successful delivery is a non-event for the
 * household. Once the shopping has arrived and been counted into the food at
 * home, the household sees one short "arrived" line and nothing else — no
 * audit trail, no control-plane wording, no second confirmation journey.
 * A dedicated interaction is only offered when something actually needs a
 * household decision: a basket to review, or a delivery with discrepancies.
 *
 * This module invents nothing and decides nothing about state; it only turns
 * an already-established state into household language.
 */

export type DeliveryScreenStage = "UNAVAILABLE" | "NEEDS_REVIEW" | "CONFIRM" | "SETTLED";

export interface DeliveryScreenView {
  stage: DeliveryScreenStage;
  title: string;
  /** One short household sentence. Never more than the household needs. */
  body: string;
  /** True only when the household still has something to decide here. */
  needsHousehold: boolean;
}

export interface DeliveryScreenInput {
  /** True when a canonical basket for this delivery could be read. */
  basketReady: boolean;
  /** Approval state of that basket, or null when there is none. */
  approvalStatus: "PENDING" | "APPROVED" | null;
  /** True when this exact delivery is already counted into the food at home. */
  countedIn: boolean;
  /** True when the household just finished counting it in on this screen. */
  justCountedIn?: boolean;
}

export function describeDeliveryScreen(input: DeliveryScreenInput): DeliveryScreenView {
  if (input.countedIn || input.justCountedIn) {
    return {
      stage: "SETTLED",
      title: "Your shopping has arrived",
      body: "It's been counted into your food. There's nothing else to do here.",
      needsHousehold: false,
    };
  }

  if (!input.basketReady) {
    return {
      stage: "UNAVAILABLE",
      title: "Your delivery",
      body: "There's no delivery waiting for you right now.",
      needsHousehold: false,
    };
  }

  if (input.approvalStatus === "PENDING") {
    return {
      stage: "NEEDS_REVIEW",
      title: "Check this shop first",
      body: "A few things need your eye before this shop can be treated as agreed.",
      needsHousehold: true,
    };
  }

  return {
    stage: "CONFIRM",
    title: "Has your shopping arrived?",
    body: "If it all came, one tap counts it into your food. Only tell FoodOS about anything missing or different.",
    needsHousehold: true,
  };
}
