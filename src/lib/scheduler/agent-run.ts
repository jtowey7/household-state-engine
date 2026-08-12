/**
 * Food OS — AGENT RUN evidence record.
 *
 * Every stateless wake-up must leave a durable, Airtable-shaped audit row so a
 * human can see what the scheduler did without trusting the scheduler's memory.
 * The record is derived purely from the cycle evidence, so it is deterministic
 * and replayable, and it is append-only: a duplicate wake-up re-derives the
 * same Run ID and appends nothing new.
 *
 * SYNTHETIC ONLY: this sink is in-memory. No Airtable connector is wired here.
 */

import type {
  AgentRunRecord,
  AgentRunSink,
  DirectiveClaim,
  SchedulerCycleEvidence,
} from "./types";

/** Map cycle evidence onto the AGENT RUN row shape. */
export function toAgentRunRecord(
  evidence: SchedulerCycleEvidence,
  claim: DirectiveClaim | null = evidence.claim,
): AgentRunRecord {
  return {
    "Run ID": `RUN-${evidence.cycleId}`,
    "Record class": "Test",
    Mode: "SYNTHETIC",
    "Cycle ID": evidence.cycleId,
    "Wake at": evidence.wakeAt,
    "Control plane snapshot": evidence.controlPlaneSnapshotId,
    "Directive selected": evidence.directiveSelected,
    "Directive kind": evidence.directiveKind,
    "Claim ID": claim?.claimId ?? null,
    Outcome: evidence.outcome,
    "Work performed": evidence.workPerformed,
    "Checks passed": evidence.checks.filter((c) => c.passed).length,
    "Checks total": evidence.checks.length,
    "Proposal IDs": [...evidence.proposalIds],
    "Blocked actions": evidence.blockedActions.map((b) => `${b.action}: ${b.reason}`),
    "Snapshot ID": evidence.nextHandoff.snapshotId,
    "Replay ID": evidence.nextHandoff.replayId,
    "Reconciliation status": evidence.nextHandoff.reconciliationStatus,
    "Plan ID": evidence.nextHandoff.planId,
    "Basket ID": evidence.nextHandoff.basketId,
    "Next directive": evidence.nextHandoff.nextDirectiveId,
    "Duplicate wake of": evidence.duplicateWakeOf,
    "Mutated household state": false,
    "Appended events": false,
    Dispatched: false,
    "Requires human approval": true,
  };
}

/** In-memory append-only AGENT RUN sink, idempotent on Run ID. */
export function createMemoryAgentRunSink(
  seed: readonly AgentRunRecord[] = [],
): AgentRunSink & { records: AgentRunRecord[] } {
  const records: AgentRunRecord[] = [...seed];
  return {
    records,
    append(record) {
      const existing = records.find((r) => r["Run ID"] === record["Run ID"]);
      if (existing) return { persisted: false, runId: record["Run ID"], deduplicated: true };
      records.push(record);
      return { persisted: true, runId: record["Run ID"], deduplicated: false };
    },
    list() {
      return [...records];
    },
  };
}
