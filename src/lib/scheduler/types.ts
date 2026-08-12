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
  /** cycleId of the handoff this wake-up resumed from, if any. */
  resumedFromHandoff: string | null;
  /** Non-fatal handoff verification findings; isolated, never silent. */
  handoffWarnings: HandoffWarning[];
  /** Set when this wake-up was a duplicate delivery and did no new work. */
  duplicateWakeOf: string | null;
  /** Lease held over the selected directive; null when nothing was claimed. */
  claim: DirectiveClaim | null;
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
  /** Sealed continuity record to persist in the control plane. */
  sealedHandoff?: HandoffRecord;
  /** AGENT RUN audit row derived from this cycle's evidence. */
  agentRun?: AgentRunRecord;
  /** Receipt from the AGENT RUN sink, when one was provided. */
  agentRunReceipt?: AgentRunAppendReceipt;
}

/**
 * Durable, integrity-sealed continuity record between stateless wake-ups.
 * Stored in the control plane; treated as untrusted input when read back.
 */
export interface HandoffRecord {
  mode: "SYNTHETIC";
  cycleId: string;
  snapshotId: string;
  producedAt: string;
  completedDirectiveIds: string[];
  nextDirectiveId: string | null;
  /** Content digest over every other field. */
  digest: string;
}

export type HandoffWarningCode =
  | "SNAPSHOT_ROTATED"
  | "UNKNOWN_DIRECTIVE"
  | "TEST_CLASS_DIRECTIVE";

export interface HandoffWarning {
  code: HandoffWarningCode;
  detail: string;
  directiveId?: string;
}

export type HandoffRefusalCode = "TAMPERED_HANDOFF" | "WRONG_MODE";

export type HandoffVerdict =
  | { accepted: true; completedDirectiveIds: string[]; warnings: HandoffWarning[] }
  | { accepted: false; refusal: { code: HandoffRefusalCode; detail: string } };

/** One recorded wake-up, used to make duplicate scheduler deliveries inert. */
export interface WakeLedgerEntry {
  cycleId: string;
  evidence: SchedulerCycleEvidence;
}

/** A lease held by one wake-up over one directive. Control-plane state. */
export interface DirectiveClaim {
  claimId: string;
  directiveId: string;
  cycleId: string;
  claimedAt: string;
  expiresAt: string;
}

export type ClaimRefusalCode = "CLAIMED_BY_ANOTHER_CYCLE" | "INVALID_WAKE_TIME";

export type ClaimVerdict =
  | { granted: true; claim: DirectiveClaim; reclaimedExpired: boolean }
  | { granted: false; refusal: { code: ClaimRefusalCode; detail: string } };

/** Airtable-shaped AGENT RUN audit row derived from cycle evidence. */
export interface AgentRunRecord {
  "Run ID": string;
  "Record class": "Test" | "Production";
  Mode: "SYNTHETIC";
  "Cycle ID": string;
  "Wake at": string;
  "Control plane snapshot": string;
  "Directive selected": string | null;
  "Directive kind": DirectiveKind | null;
  "Claim ID": string | null;
  Outcome: CycleOutcome;
  "Work performed": string;
  "Checks passed": number;
  "Checks total": number;
  "Proposal IDs": string[];
  "Blocked actions": string[];
  "Snapshot ID": string | null;
  "Replay ID": string | null;
  "Reconciliation status": string | null;
  "Plan ID": string | null;
  "Basket ID": string | null;
  "Next directive": string | null;
  "Duplicate wake of": string | null;
  "Mutated household state": false;
  "Appended events": false;
  Dispatched: false;
  "Requires human approval": true;
}

export interface AgentRunAppendReceipt {
  persisted: boolean;
  runId: string;
  deduplicated: boolean;
}

/** Append-only sink for AGENT RUN rows. No connector is wired in this build. */
export interface AgentRunSink {
  append(record: AgentRunRecord): AgentRunAppendReceipt;
  list(): AgentRunRecord[];
}

// ---------------------------------------------------------------------------
// Durable control-plane persistence (Airtable adapter contract)
// ---------------------------------------------------------------------------

export type ClaimReadResult =
  | { status: "OK"; claims: DirectiveClaim[] }
  | { status: "FAILED"; detail: string };

export type ClaimPersistResult =
  | { status: "PERSISTED"; claim: DirectiveClaim }
  | { status: "ALREADY_HELD"; claim: DirectiveClaim }
  | { status: "COLLISION"; detail: string; holder: DirectiveClaim }
  | { status: "FAILED"; detail: string };

export type AgentRunPersistResult =
  | { status: "PERSISTED"; runId: string }
  | { status: "DEDUPLICATED"; runId: string }
  | { status: "FAILED"; runId: string; detail: string };

/**
 * Durable persistence seam for the stateless scheduler. Implementations must
 * never throw: every failure is an explicit FAILED result so a wake-up can end
 * as an explicit cycle failure instead of silently reporting success.
 */
export interface SchedulerPersistence {
  listActiveClaims(directiveId: string, asOf: string): Promise<ClaimReadResult>;
  persistClaim(claim: DirectiveClaim): Promise<ClaimPersistResult>;
  appendAgentRun(record: AgentRunRecord): Promise<AgentRunPersistResult>;
}

/** What this wake-up managed to persist in the control plane. */
export interface CyclePersistenceEvidence {
  claim: ClaimPersistResult["status"] | "SKIPPED";
  agentRun: AgentRunPersistResult["status"] | "SKIPPED";
  detail: string | null;
}
