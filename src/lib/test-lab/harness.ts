/**
 * Food OS — TEST LAB integration harness (isolated).
 *
 * Wires the existing State Engine replay to the existing quantity/procurement
 * bridge end-to-end on SYNTHETIC fixtures only. No Airtable, no real household
 * production state, no procurement dispatch. Existing aggregation, pack
 * rounding and ACTION POLICY boundaries are used as-is, not re-implemented.
 */

import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type {
  HouseholdEvent,
  QuantityRequirementsHandoff,
  StateSnapshot,
} from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import type { DemandTarget, QuantityRunPlan } from "../quantity-adapter/types";

export interface IntegrationRunOptions {
  targets: readonly DemandTarget[];
  now?: () => string;
}

export interface IntegrationRun {
  snapshot: StateSnapshot;
  handoff: QuantityRequirementsHandoff;
  plan: QuantityRunPlan;
  /** Identity carried end-to-end. */
  snapshotId: string;
  replayId: string;
  reconciliationStatus: StateSnapshot["reconciliationStatus"];
  /** Union of source event IDs surfaced to the quantity bridge. */
  sourceEventIds: string[];
  /** TEST LAB never dispatches procurement. */
  dispatched: false;
}

/** replayEvents -> toQuantityRequirementsHandoff -> adaptSnapshotToQuantityRun. */
export function runReplayToQuantityIntegration(
  events: readonly HouseholdEvent[],
  options: IntegrationRunOptions,
): IntegrationRun {
  const snapshot = replayEvents(events, options.now ? { now: options.now } : {});
  const handoff = toQuantityRequirementsHandoff(snapshot);
  const plan = adaptSnapshotToQuantityRun(handoff, { targets: options.targets });
  const sourceEventIds = [
    ...new Set(plan.requirements.flatMap((r) => r.sourceEventIds)),
  ];
  return {
    snapshot,
    handoff,
    plan,
    snapshotId: snapshot.snapshotId,
    replayId: snapshot.replayId,
    reconciliationStatus: snapshot.reconciliationStatus,
    sourceEventIds,
    dispatched: false,
  };
}

export interface LabCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface LabCaseResult {
  caseId: string;
  title: string;
  reconciliationStatus: string;
  snapshotId: string;
  replayId: string;
  eligibleForProcurement: boolean;
  executed: boolean;
  dispatched: false;
  requirementItems: string[];
  rejectionCodes: string[];
  sourceEventIds: string[];
  checks: LabCheck[];
  passed: boolean;
}

export interface LabCase {
  caseId: string;
  title: string;
  events: HouseholdEvent[];
  /** Assertions evaluated against the real integration output. */
  assert: (run: IntegrationRun, rerun: IntegrationRun) => LabCheck[];
}

/** Executes a lab case twice to prove deterministic repeatability. */
export function runLabCase(lab: LabCase, options: IntegrationRunOptions): LabCaseResult {
  const run = runReplayToQuantityIntegration(lab.events, options);
  const rerun = runReplayToQuantityIntegration(lab.events, options);
  const checks = lab.assert(run, rerun);
  return {
    caseId: lab.caseId,
    title: lab.title,
    reconciliationStatus: run.reconciliationStatus,
    snapshotId: run.snapshotId,
    replayId: run.replayId,
    eligibleForProcurement: run.plan.eligibleForProcurement,
    executed: run.plan.executed,
    dispatched: false,
    requirementItems: run.plan.requirements.map((r) => r.itemKey),
    rejectionCodes: run.plan.rejections.map((r) => r.code),
    sourceEventIds: run.sourceEventIds,
    checks,
    passed: checks.every((c) => c.passed),
  };
}

export function runLabSuite(
  cases: readonly LabCase[],
  options: IntegrationRunOptions,
): { results: LabCaseResult[]; passed: number; failed: number } {
  const results = cases.map((c) => runLabCase(c, options));
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, failed: results.length - passed };
}
