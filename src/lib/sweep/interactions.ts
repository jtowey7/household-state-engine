/**
 * Pure interaction layer for the Quick Stock Sweep and Tell Food OS surfaces.
 *
 * Every tap produces an inspectable, evidence-shaped object. Nothing mutates
 * inventory: evidence is reconciled against the plan by the existing
 * expected-vs-confirmed ledger, and the resulting status is what the UI shows.
 */

import { reconcileExpectedWithConfirmed } from "../expected-state/ledger";
import type { ConsumptionEvidence, ReconciliationRun } from "../expected-state/types";
import {
  SWEEP_AS_OF,
  expectationForItem,
  fixtureForItem,
  sweepExpectations,
  sweepOpeningEvents,
} from "./fixtures";

export type SweepAction = "GONE" | "USED_AS_PLANNED" | "WASTED" | "DIFFERENT_QUANTITY";

export type TellIntent =
  | "USED_SOMETHING"
  | "BOUGHT_SOMETHING"
  | "WASTED_SOMETHING"
  | "CHANGED_A_MEAL"
  | "FREE_TEXT";

export interface SweepTap {
  /** Stable per-tap identity so repeat delivery is idempotent. */
  evidenceId: string;
  itemKey: string;
  action: SweepAction;
  /** Required for DIFFERENT_QUANTITY; ignored otherwise. */
  quantity?: number | null;
  observedAt: string;
  actor?: string;
}

export interface TellReport {
  evidenceId: string;
  intent: TellIntent;
  itemKey: string;
  quantity?: number | null;
  unit?: string | null;
  observedAt: string;
  text?: string;
  actor?: string;
}

/** A sweep tap is a first-hand observation; it never edits stock directly. */
export function evidenceFromSweepTap(tap: SweepTap): ConsumptionEvidence {
  const fixture = fixtureForItem(tap.itemKey);
  const expectation = expectationForItem(tap.itemKey);
  const unit = fixture?.unit ?? expectation?.unit ?? null;

  let observedQuantity: number | null = null;
  switch (tap.action) {
    case "USED_AS_PLANNED":
      observedQuantity = expectation?.quantity ?? null;
      break;
    case "GONE":
    case "WASTED":
      observedQuantity = fixture?.openingQuantity ?? null;
      break;
    case "DIFFERENT_QUANTITY":
      observedQuantity =
        typeof tap.quantity === "number" && Number.isFinite(tap.quantity) ? tap.quantity : null;
      break;
  }

  return {
    evidenceId: tap.evidenceId,
    expectationId: expectation?.expectationId ?? null,
    itemKey: tap.itemKey,
    observedQuantity,
    unit,
    observedAt: tap.observedAt,
    actor: tap.actor ?? "household member",
    source: `quick-stock-sweep:${tap.action}`,
    // A missing quantity stays UNKNOWN so it cannot confirm anything.
    confidence: observedQuantity === null ? "UNKNOWN" : "OBSERVED",
    ...(tap.action === "WASTED"
      ? { note: "reported as wasted" }
      : tap.action === "GONE"
        ? { note: "reported as gone" }
        : {}),
    recordClass: "Production",
  };
}

/**
 * A free-form report is second-hand at best. Intents that do not describe an
 * observed burn (a purchase, a plan change, ad-hoc text) deliberately produce
 * insufficient evidence: Food OS records the report and isolates the item
 * rather than pretending to know the new quantity.
 */
export function evidenceFromTellReport(report: TellReport): ConsumptionEvidence {
  const fixture = fixtureForItem(report.itemKey);
  const expectation = expectationForItem(report.itemKey);
  const consumptionLike =
    report.intent === "USED_SOMETHING" || report.intent === "WASTED_SOMETHING";
  const quantity =
    consumptionLike && typeof report.quantity === "number" && Number.isFinite(report.quantity)
      ? report.quantity
      : null;

  return {
    evidenceId: report.evidenceId,
    expectationId: report.intent === "USED_SOMETHING" ? (expectation?.expectationId ?? null) : null,
    itemKey: report.itemKey,
    observedQuantity: quantity,
    unit: report.unit ?? fixture?.unit ?? null,
    observedAt: report.observedAt,
    actor: report.actor ?? "household member",
    source: `tell-food-os:${report.intent}`,
    confidence: quantity === null ? "UNKNOWN" : "REPORTED",
    ...(report.text?.trim() ? { note: report.text.trim() } : {}),
    recordClass: "Production",
  };
}

export type InteractionStatus =
  | "CONFIRMED"
  | "AWAITING_CONFIRMATION"
  | "DIVERGED"
  | "BLOCKED"
  | "RECORDED_UNPLANNED";

export interface InteractionOutcome {
  itemKey: string;
  status: InteractionStatus;
  detail: string;
  evidenceIds: string[];
  expectedQuantity: number | null;
  confirmedQuantity: number | null;
  unit: string | null;
}

/** Runs the synthetic household through the reconciliation ledger. */
export function runSweep(evidence: readonly ConsumptionEvidence[]): ReconciliationRun {
  return reconcileExpectedWithConfirmed(
    {
      openingEvents: sweepOpeningEvents,
      expectations: sweepExpectations,
      evidence,
    },
    { asOf: SWEEP_AS_OF, now: () => SWEEP_AS_OF, tolerance: 0 },
  );
}

/** Maps ledger entries into the household-facing status vocabulary. */
export function outcomesFor(run: ReconciliationRun): InteractionOutcome[] {
  return run.entries.map((e) => {
    const status: InteractionStatus =
      e.blocking || run.blockedItemKeys.includes(e.itemKey)
        ? e.status === "DIVERGED"
          ? "DIVERGED"
          : "BLOCKED"
        : e.status === "MATCHED"
          ? "CONFIRMED"
          : e.status === "UNEXPECTED_CONFIRMED"
            ? "RECORDED_UNPLANNED"
            : "AWAITING_CONFIRMATION";
    return {
      itemKey: e.itemKey,
      status,
      detail: e.detail,
      evidenceIds: e.evidenceIds,
      expectedQuantity: e.expectedQuantity,
      confirmedQuantity: e.confirmedQuantity,
      unit: e.unit,
    };
  });
}

export function outcomeForItem(
  run: ReconciliationRun,
  itemKey: string,
): InteractionOutcome | undefined {
  const all = outcomesFor(run).filter((o) => o.itemKey === itemKey);
  return (
    all.find((o) => o.status === "BLOCKED" || o.status === "DIVERGED") ?? all[all.length - 1]
  );
}
