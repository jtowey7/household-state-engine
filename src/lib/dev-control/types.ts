/**
 * Food OS — DEVELOPMENT CONTROL DASHBOARD contracts.
 *
 * Boundary: read-only, synthetic/test-only observability. This module never
 * writes household state, never dispatches procurement and never connects to
 * real household production data. It projects already-produced evidence
 * (weekly shadow cycles, scheduler wake-ups, integration lab suite, connector
 * configuration) into plain-English operator answers.
 */

import type { SchedulerCycleResult } from "../scheduler/types";
import type { LabCaseResult } from "../test-lab/harness";
import type { WeeklyCycleRun } from "../weekly-cycle/types";

export type Health = "GREEN" | "AMBER" | "RED";
export type Severity = "RED" | "AMBER" | "INFO";

/** Configuration presence of the read-only Airtable connector. */
export interface ConnectivitySignal {
  status: "CONFIGURED" | "NOT_CONFIGURED" | "UNKNOWN";
  detail: string;
  missing: string[];
}

export interface WeeklySignal {
  id: string;
  /** Plain-English name of the scenario this run represents. */
  label: string;
  /** True when this scenario is a deliberate demonstration of a failure path. */
  expected?: boolean;
  run: WeeklyCycleRun;
}

export interface SchedulerSignal {
  id: string;
  label: string;
  /** True when this wake-up is a deliberate demonstration of a blocked path. */
  expected?: boolean;
  result: SchedulerCycleResult;
}

export interface LabSignal {
  results: LabCaseResult[];
  passed: number;
  failed: number;
}

export interface DevControlSignals {
  now: string;
  weekly: WeeklySignal[];
  scheduler: SchedulerSignal[];
  lab: LabSignal;
  connectivity: ConnectivitySignal;
}

/** A component of the system, described for a non-specialist reader. */
export interface ComponentNote {
  name: string;
  /** What this part of Food OS actually does, in plain English. */
  does: string;
  /** Where it lives, for the engineering drill-down. */
  path: string;
}

/** Something the operator may need to act on, with its drill-down. */
export interface AttentionItem {
  id: string;
  severity: Severity;
  /** Plain-English headline. */
  title: string;
  /** What it means for the household / for the build. */
  meaning: string;
  /** Why it is happening — the root cause, not a restatement. */
  rootCause: string;
  /** What Food OS will and will not do while this stands. */
  consequence: string;
  /** Raw evidence lines (IDs, statuses, counters). Secondary detail. */
  evidence: string[];
  /** The underlying work item this maps to. */
  workItem: { ref: string; title: string; state: "OPEN" | "EXPECTED" | "DONE" };
  component: ComponentNote;
}

export type JobState = "RAN" | "READY" | "BLOCKED" | "OFFLINE" | "REFUSED" | "IDLE";

export interface JobRow {
  id: string;
  title: string;
  /** What this scheduled job is for. */
  purpose: string;
  state: JobState;
  detail: string;
  /** Last observed outcome from the scheduler wake-up evidence. */
  lastOutcome: string;
  /** Wake timestamp of the observed cycle. */
  lastWakeAt: string | null;
  cycleId: string | null;
  attentionId: string | null;
}

export interface EvidenceRow {
  id: string;
  label: string;
  passed: number;
  total: number;
  green: boolean;
  detail: string;
  failing: string[];
}

export interface RunningRow {
  id: string;
  label: string;
  /** Plain-English statement of what the run did. */
  summary: string;
  status: WeeklyCycleRun["status"];
  stageSummary: { stage: string; status: string; detail: string }[];
  cycleId: string;
  snapshotId: string | null;
  replayId: string | null;
  isolatedItemKeys: string[];
  approval: string;
  attentionIds: string[];
}

export interface RoadmapBlock {
  id: string;
  title: string;
  /** Plain-English purpose of the block. */
  purpose: string;
  state: "DONE" | "IN_PROGRESS" | "NOT_STARTED";
  /** 0-100, hand-maintained from real delivered slices. */
  progress: number;
  /** Live evidence sentence, derived from signals where possible. */
  evidence: string;
  components: ComponentNote[];
}

export interface ShiftEntry {
  id: string;
  /** ISO date of the shift. */
  at: string;
  title: string;
  /** Plain-English description of what changed. */
  change: string;
  kind: "CAPABILITY" | "RELIABILITY" | "UI" | "SAFETY";
}

export interface DevControlReport {
  now: string;
  health: Health;
  /** One-sentence plain-English answer to "is Food OS healthy?". */
  headline: string;
  /** Short supporting sentences, safe to show on a phone. */
  bullets: string[];
  running: RunningRow[];
  jobs: JobRow[];
  evidence: EvidenceRow[];
  attention: AttentionItem[];
  roadmap: RoadmapBlock[];
  shifts: ShiftEntry[];
  /** Invariants this dashboard asserts by construction. */
  readonly readOnly: true;
  readonly mutatedHouseholdState: false;
  readonly dispatched: false;
}
