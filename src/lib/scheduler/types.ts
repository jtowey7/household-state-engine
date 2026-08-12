/**
 * Food OS — scheduler-driven stateless cycle contracts.
 *
 * The execution layer is a stateless scheduled wake-up (ChatGPT Scheduled
 * Tasks). It holds no memory between invocations: every cycle re-reads the
 * control plane, re-selects work and re-derives its result. Durable truth
 * lives in the control plane (Airtable-shaped), never in the scheduler.
 *
 * Nothing here writes household state, dispatches procurement, or self-approves.
 */

import type { WeeklyCycleRun } from "../weekly-cycle/types";

export type DirectiveKind =
  | "WEEKLY_SHADOW_CYCLE"
  | "STOCK_EXCEPTION_REVIEW"
  | "MEAL_COMPLETION_SWEEP"
  | "UNSUPPORTED";

export type DirectivePriority = "P0" | "P1" | "P2";
export type DirectiveStatus = "READY" | "BLOCKED" | "DONE";

/** ACTION POLICY: the scheduler may PREPARE; it may never auto-EXECUTE. */
export type ActionPolicy = "PREPARE" | "EXECUTE";

export interface ControlPlaneDirective {
  directiveId: string;
  title: string;
  kind: DirectiveKind;
  priority: DirectivePriority;
  status: DirectiveStatus;
  actionPolicy: ActionPolicy;
  /** Directive IDs that must be DONE before this one is selectable. */
  dependsOn?: readonly string[];
  /** Explicit human-authored block reason; always honoured. */
  blockedReason?: string;
  /** Test-class control rows are never executed against production logic. */
  recordClass?: "Production" | "Test";
}

export interface ControlPlaneSnapshot {
  /** SYNTHETIC only in this workspace. */
  mode: "SYNTHETIC";
  snapshotId: string;
  readAt: string;
  directives: readonly ControlPlaneDirective[];
}

export type SelectionRefusalCode =
  | "NO_DIRECTIVES"
  | "ALL_BLOCKED"
  | "ALL_DONE"
  | "NOT_PRODUCTION_MODE";

export type WorkSelection =
  | { selected: true; directive: ControlPlaneDirective; consideredIds: string[] }
  | {
      selected: false;
      refusal: { code: SelectionRefusalCode; detail: string };
      consideredIds: string[];
      blocked: { directiveId: string; reason: string }[];
    };

export type CycleOutcome = "EXECUTED" | "BLOCKED" | "REFUSED" | "NO_WORK";

export interface CycleCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface BlockedAction {
  action: string;
  reason: string;
}

export interface SchedulerCycleEvidence {
  /** Deterministic: same control plane + same wake input => same cycleId. */
  cycleId: string;
  wakeAt: string;
  controlPlaneSnapshotId: string;
  directiveSelected: string | null;
  directiveKind: DirectiveKind | null;
  workPerformed: string;
  outcome: CycleOutcome;
  checks: CycleCheck[];
  /** Canonical proposal identities produced this cycle (never written). */
  proposalIds: string[];
  blockedActions: BlockedAction[];
  /** Replayable handoff for the next stateless wake-up. */
  nextHandoff: {
    nextDirectiveId: string | null;
    /** Directives the next cycle should treat as already satisfied. */
    completedDirectiveIds: string[];
    snapshotId: string | null;
    replayId: string | null;
    reconciliationStatus: string | null;
    planId: string | null;
    basketId: string | null;
    requiresHumanApproval: true;
  };
  /** Invariants asserted by construction. */
  readonly mutatedHouseholdState: false;
  readonly appendedEvents: false;
  readonly dispatched: false;
}

export interface SchedulerCycleResult {
  evidence: SchedulerCycleEvidence;
  selection: WorkSelection;
  /** Present only when the selected directive ran the weekly shadow cycle. */
  run: WeeklyCycleRun | null;
}
