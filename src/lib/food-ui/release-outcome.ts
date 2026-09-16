/**
 * Food OS — what actually happened when a household update was saved.
 *
 * The release path can end in four different states, and the household screen
 * previously collapsed three of them into one misleading sentence ("nothing
 * was saved; the approval step did not complete"). That hid the real reason
 * and, worse, reported an already-saved (idempotent) update as a failure.
 *
 * This helper reads the receipts the existing writer already returns and
 * states the truth in plain household language. It changes no authority, no
 * provenance and no write behaviour.
 */

import { householdRefusalMessage } from "./refusal-copy";

export interface ReleaseReceiptLike {
  outcome: string;
  written: boolean;
  rejection?: { code?: string | null; detail?: string | null } | null;
}

export interface ReleaseOutcome {
  /** True when the household record now holds this update. */
  saved: boolean;
  label: string;
  message: string;
}

export function releaseOutcomeFor(result: {
  written?: boolean;
  receipts?: readonly ReleaseReceiptLike[];
}): ReleaseOutcome {
  const receipts = result.receipts ?? [];

  if (result.written === true || receipts.some((receipt) => receipt.written)) {
    return {
      saved: true,
      label: "Saved",
      message: "Saved to your household record — what you have above is up to date.",
    };
  }

  if (receipts.some((receipt) => receipt.outcome === "DUPLICATE_NOOP")) {
    return {
      saved: true,
      label: "Saved",
      message: "This update was already saved, so foodOS left your food list exactly as it is.",
    };
  }

  const refused = receipts.find((receipt) => receipt.outcome === "REJECTED" && receipt.rejection);
  if (refused?.rejection) {
    return {
      saved: false,
      label: "Not saved",
      message: householdRefusalMessage(refused.rejection),
    };
  }

  return {
    saved: false,
    label: "Not saved",
    message:
      "FoodOS got this update ready but could not finish saving it, so nothing in your food list changed. Try saving it again.",
  };
}
