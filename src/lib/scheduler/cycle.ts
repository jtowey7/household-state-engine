/**
 * Food OS — stateless scheduler cycle harness.
 *
 * One wake-up = one complete pass:
 *   BOOT -> read control plane -> select highest-value unblocked directive
 *        -> execute deterministic Food OS logic (existing seams only)
 *        -> produce evidence/proposals -> enforce ACTION POLICY
 *        -> persist a replayable handoff for the next wake-up.
 *
 * This harness re-implements no Food OS maths. It calls the proven weekly
 * shadow cycle, which itself chains the read-only production adapter, the
 * consumption projector, State Engine replay, the QUANTITY REQUIREMENTS
 * handoff, the quantity/procurement bridge and the human approval gate.
 *
 * SYNTHETIC ONLY: no real household state, no writes, no dispatch.
 */

import { hashOf } from "../state-engine/hash";
import { runWeeklyShadowCycle } from "../weekly-cycle/cycle";
import type { WeeklyCycleOptions, WeeklyCycleRun } from "../weekly-cycle/types";
import { toAgentRunRecord } from "./agent-run";
import { claimDirective } from "./claim";
import { selectWork } from "./control-plane";
import { sealHandoff, verifyHandoff } from "./handoff";
import type {
  AgentRunSink,
  BlockedAction,
  ControlPlaneSnapshot,
  CycleCheck,
  CycleOutcome,
  DirectiveClaim,
  HandoffRecord,
  HandoffWarning,
  SchedulerCycleEvidence,
  SchedulerCycleResult,
  WakeLedgerEntry,
  WorkSelection,
} from "./types";

export interface SchedulerCycleOptions {
  controlPlane: ControlPlaneSnapshot;
  /** Wake timestamp supplied by the scheduler; deterministic in tests. */
  wakeAt: string;
  /** Everything the weekly shadow cycle needs. Synthetic fixtures only. */
  work: WeeklyCycleOptions;
  /** Handoff carried forward by the control plane, not by process memory. */
  completedDirectiveIds?: readonly string[];
  /** Sealed durable handoff from the previous wake-up; verified, never trusted. */
  handoff?: HandoffRecord;
  /** Wake-ups already recorded; a repeat delivery must do no further work. */
  wakeLedger?: readonly WakeLedgerEntry[];
  /** Directive leases currently recorded in the control plane. */
  activeClaims?: readonly DirectiveClaim[];
  /** Lease duration for a granted claim; defaults to DEFAULT_LEASE_MS. */
  leaseMs?: number;
  /** Append-only AGENT RUN sink; when absent the record is still returned. */
  agentRunSink?: AgentRunSink;
  /** Durable control-plane persistence (Airtable adapter). Optional. */
  persistence?: SchedulerPersistence;
}



function emptyHandoff(): SchedulerCycleEvidence["nextHandoff"] {
  return {
    nextDirectiveId: null,
    completedDirectiveIds: [],
    snapshotId: null,
    replayId: null,
    reconciliationStatus: null,
    planId: null,
    basketId: null,
    requiresHumanApproval: true,
  };
}

function proposalIdsOf(run: WeeklyCycleRun): string[] {
  const ids = run.appendProposals
    .map((p) => p.record?.eventId)
    .filter((id): id is string => typeof id === "string");
  return [...new Set(ids)].sort();
}

function cycleIdFor(options: SchedulerCycleOptions, directiveId: string | null): string {
  return `CYCLE-${hashOf({
    snapshotId: options.controlPlane.snapshotId,
    wakeAt: options.wakeAt,
    directiveId,
    scope: options.work.scope,
    asOf: options.work.asOf,
  }).slice(0, 16)}`;
}

async function runSchedulerCycleCore(
  options: SchedulerCycleOptions,
): Promise<SchedulerCycleResult> {
  const completed = [...(options.completedDirectiveIds ?? [])];
  const selection: WorkSelection = selectWork(options.controlPlane, {
    completedDirectiveIds: completed,
  });

  const base = {
    wakeAt: options.wakeAt,
    controlPlaneSnapshotId: options.controlPlane.snapshotId,
    resumedFromHandoff: options.handoff?.cycleId ?? null,
    handoffWarnings: [] as HandoffWarning[],
    duplicateWakeOf: null,
    claim: null as DirectiveClaim | null,
    mutatedHouseholdState: false as const,
    appendedEvents: false as const,
    dispatched: false as const,
  };

  if (!selection.selected) {
    const outcome: CycleOutcome = selection.refusal.code === "ALL_BLOCKED" ? "BLOCKED" : "NO_WORK";
    return {
      selection,
      run: null,
      evidence: {
        ...base,
        cycleId: cycleIdFor(options, null),
        directiveSelected: null,
        directiveKind: null,
        workPerformed: "No directive executed; the wake-up ended without touching Food OS state.",
        outcome,
        checks: [
          {
            label: "Work selection",
            passed: false,
            detail: selection.refusal.detail,
          },
        ],
        proposalIds: [],
        blockedActions: selection.blocked.map((b) => ({
          action: `Directive ${b.directiveId}`,
          reason: b.reason,
        })),
        nextHandoff: { ...emptyHandoff(), completedDirectiveIds: [...completed].sort() },
      },
    };
  }

  const directive = selection.directive;
  const cycleId = cycleIdFor(options, directive.directiveId);
  const blockedActions: BlockedAction[] = [];

  const verdict = claimDirective({
    directiveId: directive.directiveId,
    cycleId,
    wakeAt: options.wakeAt,
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.activeClaims === undefined ? {} : { activeClaims: options.activeClaims }),
  });
  if (!verdict.granted) {
    return {
      selection,
      run: null,
      evidence: {
        ...base,
        cycleId,
        directiveSelected: directive.directiveId,
        directiveKind: directive.kind,
        workPerformed:
          "No work performed: another wake-up already holds the lease on this directive.",
        outcome: "BLOCKED",
        checks: [
          { label: "Directive claim", passed: false, detail: verdict.refusal.detail },
        ],
        proposalIds: [],
        blockedActions: [
          ...blockedActions,
          { action: `Claim ${directive.directiveId}`, reason: verdict.refusal.code },
        ],
        nextHandoff: { ...emptyHandoff(), completedDirectiveIds: [...completed].sort() },
      },
    };
  }
  const claim = verdict.claim;
  base.claim = claim;

  if (directive.actionPolicy === "EXECUTE") {
    blockedActions.push({
      action: `Auto-execute ${directive.directiveId}`,
      reason:
        "ACTION POLICY: a scheduled wake-up may only PREPARE. Execution stays with a human decision.",
    });
  }

  if (directive.kind === "UNSUPPORTED") {
    return {
      selection,
      run: null,
      evidence: {
        ...base,
        cycleId,
        directiveSelected: directive.directiveId,
        directiveKind: directive.kind,
        workPerformed: `Directive ${directive.directiveId} has no executable seam in this runtime.`,
        outcome: "REFUSED",
        checks: [
          {
            label: "Executable seam exists",
            passed: false,
            detail: "No proven Food OS seam implements this directive kind; nothing was guessed.",
          },
        ],
        proposalIds: [],
        blockedActions: [
          ...blockedActions,
          {
            action: directive.title,
            reason: "Unsupported directive kind — refused rather than approximated.",
          },
        ],
        nextHandoff: { ...emptyHandoff(), completedDirectiveIds: [...completed].sort() },
      },
    };
  }

  const run = await runWeeklyShadowCycle(options.work);
  const procurementRelevant = directive.kind === "WEEKLY_SHADOW_CYCLE";
  const proposalIds = proposalIdsOf(run);

  const checks: CycleCheck[] = [
    {
      label: "Source read is read-only",
      passed: !run.source?.writable && !run.mutatedHouseholdState,
      detail: "The production state port exposes no write path and the cycle mutated nothing.",
    },
    {
      label: "Replay completed",
      passed: run.snapshot !== null,
      detail: run.snapshot
        ? `snapshotId=${run.snapshot.snapshotId} replayId=${run.snapshot.replayId} reconciliation=${run.snapshot.reconciliationStatus}`
        : "Replay did not run because the source read was refused.",
    },
    {
      label: "Proposals require human authorisation",
      passed: run.appendProposals.every((p) => p.requiresHumanAuthorization),
      detail: `${run.appendProposals.length} canonical append proposal(s); ${proposalIds.length} carry an immutable Event ID. None written.`,
    },
    {
      label: "Nothing dispatched",
      passed: run.dispatched === false && run.appendedEvents === false,
      detail: "No procurement dispatch and no connector append occurred in this wake-up.",
    },
  ];

  if (procurementRelevant) {
    checks.push({
      label: "Quantity requirements produced",
      passed: (run.plan?.requirements.length ?? 0) > 0,
      detail: run.plan
        ? `${run.plan.requirements.length} requirement(s), ${run.plan.rejections.length} rejection(s), eligible=${run.plan.eligibleForProcurement}`
        : "No quantity plan: the upstream stage refused.",
    });
  }

  if (run.isolatedItemKeys.length > 0) {
    blockedActions.push({
      action: `Plan items ${run.isolatedItemKeys.join(", ")}`,
      reason: "Item isolated by conflict/uncertainty; unrelated planning continued.",
    });
  }
  for (const rejection of run.plan?.rejections ?? []) {
    blockedActions.push({
      action: `Quantity requirement ${rejection.itemKey ?? "(run)"}`,
      reason: rejection.code,
    });
  }
  if (run.approval.readyForReview === false) {
    blockedActions.push({ action: "Human approval review", reason: run.approval.reason });
  }
  if (run.status !== "COMPLETED") {
    blockedActions.push({
      action: `Directive ${directive.directiveId}`,
      reason: `Weekly shadow cycle ended ${run.status}.`,
    });
  }

  const outcome: CycleOutcome =
    run.status === "REFUSED" ? "BLOCKED" : run.status === "FAILED" ? "REFUSED" : "EXECUTED";

  const nextCompleted =
    outcome === "EXECUTED" ? [...new Set([...completed, directive.directiveId])].sort() : [...completed].sort();
  const nextSelection = selectWork(options.controlPlane, { completedDirectiveIds: nextCompleted });

  return {
    selection,
    run,
    evidence: {
      ...base,
      cycleId,
      directiveSelected: directive.directiveId,
      directiveKind: directive.kind,
      workPerformed:
        outcome === "EXECUTED"
          ? `${directive.title}: read-only source load, consumption projection, deterministic replay, QUANTITY REQUIREMENTS handoff${procurementRelevant ? " and candidate basket aggregation" : ""}.`
          : `${directive.title}: the cycle refused before completing; no partial state was published.`,
      outcome,
      checks,
      proposalIds,
      blockedActions,
      nextHandoff: {
        nextDirectiveId: nextSelection.selected ? nextSelection.directive.directiveId : null,
        completedDirectiveIds: nextCompleted,
        snapshotId: run.snapshot?.snapshotId ?? null,
        replayId: run.snapshot?.replayId ?? null,
        reconciliationStatus: run.snapshot?.reconciliationStatus ?? null,
        planId: run.plan?.planId ?? null,
        basketId: run.basket?.basketId ?? null,
        requiresHumanApproval: true,
      },
    },
  };
}

/**
 * Stateless wake-up entry point.
 *
 * Adds two durability guarantees around the deterministic core:
 *  1. an inbound sealed handoff is verified before any directive counts as done;
 *  2. a duplicate scheduler delivery for the same wake-up performs no new work
 *     and replays the recorded evidence verbatim.
 */
export async function runSchedulerCycle(
  options: SchedulerCycleOptions,
): Promise<SchedulerCycleResult> {
  const warnings: HandoffWarning[] = [];
  let completed = [...(options.completedDirectiveIds ?? [])];

  if (options.handoff) {
    const verdict = verifyHandoff(options.controlPlane, options.handoff);
    if (!verdict.accepted) {
      const selection = selectWork(options.controlPlane, { completedDirectiveIds: [] });
      const evidence: SchedulerCycleEvidence = {
        claim: null,
        cycleId: cycleIdFor(options, null),
        wakeAt: options.wakeAt,
        controlPlaneSnapshotId: options.controlPlane.snapshotId,
        resumedFromHandoff: options.handoff.cycleId,
        handoffWarnings: [],
        duplicateWakeOf: null,
        directiveSelected: null,
        directiveKind: null,
        workPerformed:
          "Wake-up refused: the durable handoff failed verification, so no directive state was assumed.",
        outcome: "REFUSED",
        checks: [
          { label: "Handoff integrity", passed: false, detail: verdict.refusal.detail },
        ],
        proposalIds: [],
        blockedActions: [{ action: "Resume from handoff", reason: verdict.refusal.code }],
        nextHandoff: emptyHandoff(),
        mutatedHouseholdState: false,
        appendedEvents: false,
        dispatched: false,
      };
      return finish({ selection, run: null, evidence }, options.agentRunSink);
    }
    warnings.push(...verdict.warnings);
    completed = [...new Set([...completed, ...verdict.completedDirectiveIds])];
  }

  const merged: SchedulerCycleOptions = { ...options, completedDirectiveIds: completed };
  const preSelection = selectWork(options.controlPlane, { completedDirectiveIds: completed });
  const cycleId = cycleIdFor(
    merged,
    preSelection.selected ? preSelection.directive.directiveId : null,
  );

  const prior = (options.wakeLedger ?? []).find((e) => e.cycleId === cycleId);
  if (prior) {
    return finish(
      {
        selection: preSelection,
        run: null,
        evidence: { ...prior.evidence, duplicateWakeOf: prior.cycleId },
      },
      options.agentRunSink,
    );
  }

  const result = await runSchedulerCycleCore(merged);
  const evidence: SchedulerCycleEvidence = {
    ...result.evidence,
    resumedFromHandoff: options.handoff?.cycleId ?? null,
    handoffWarnings: warnings,
  };
  return finish({ ...result, evidence }, options.agentRunSink);
}

/**
 * Seal the handoff and derive the AGENT RUN audit row. When a sink is
 * supplied the row is appended there too; the sink is append-only and
 * deduplicates on Run ID, so a duplicate wake-up records nothing new.
 */
function finish(
  result: SchedulerCycleResult,
  sink: AgentRunSink | undefined,
): SchedulerCycleResult {
  const agentRun = toAgentRunRecord(result.evidence);
  const receipt = sink?.append(agentRun);
  return {
    ...result,
    sealedHandoff: sealHandoff(result.evidence),
    agentRun,
    ...(receipt ? { agentRunReceipt: receipt } : {}),
  };
}
