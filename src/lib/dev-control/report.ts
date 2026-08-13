/**
 * Food OS — DEVELOPMENT CONTROL report builder.
 *
 * Pure projection: takes already-produced evidence and answers the operator's
 * questions in plain English. It runs nothing, writes nothing and dispatches
 * nothing. Deterministic — the same signals always produce the same report.
 */

import { COMPONENTS, ROADMAP, SHIFTS } from "./catalogue";
import type {
  AttentionItem,
  DevControlReport,
  DevControlSignals,
  EvidenceRow,
  Health,
  JobRow,
  RunningRow,
  SchedulerSignal,
  WeeklySignal,
} from "./types";

const KIND_PURPOSE: Record<string, string> = {
  WEEKLY_SHADOW_CYCLE: "Runs the whole week: state, consumption, quantities and a candidate basket.",
  MEAL_COMPLETION_SWEEP: "Turns meals marked complete into the food that was used.",
  STOCK_EXCEPTION_REVIEW: "Reviews stock surprises you reported and prepares corrections.",
  UNSUPPORTED: "Recognised by the control plane but not yet implemented in the runtime.",
};

function stageAttention(signal: WeeklySignal): AttentionItem[] {
  const out: AttentionItem[] = [];
  const run = signal.run;

  for (const stage of run.stages) {
    if (stage.status === "OK" || stage.status === "SKIPPED") continue;

    const red = stage.status === "REFUSED" || stage.status === "FAILED";
    const isSource = stage.stage === "LOAD_SOURCE";
    const isGate = stage.stage === "FEEDBACK_GATE";

    out.push({
      id: `ATT-${signal.id}-${stage.stage}`,
      severity: red ? "RED" : "AMBER",
      title: isSource
        ? `Food OS could not read the household state (${signal.label})`
        : isGate
          ? `Planning was held back by a rule you gave Food OS (${signal.label})`
          : `${stage.stage.replace(/_/g, " ").toLowerCase()} needs attention (${signal.label})`,
      meaning: red
        ? "This run stopped here, so nothing further down the chain was calculated."
        : "The run continued, but it set part of the work aside instead of guessing.",
      rootCause: stage.detail,
      consequence: red
        ? "No quantities and no basket were produced for this run. Nothing was written or ordered."
        : "Unaffected items were still planned; the flagged items were isolated and left for a human.",
      evidence: [
        `stage=${stage.stage} status=${stage.status}`,
        `cycleId=${run.cycleId}`,
        ...stage.warnings,
        ...Object.entries(stage.metrics).map(([k, v]) => `${k}=${String(v)}`),
      ],
      workItem: isSource
        ? { ref: "RB-6", title: "Provision the real household connector", state: "OPEN" }
        : isGate
          ? { ref: "RB-4", title: "Human-approved propagation of durable preferences", state: "OPEN" }
          : { ref: "RB-5", title: "Scheduled autonomous operation", state: "OPEN" },
      component: isSource
        ? COMPONENTS.productionAdapter
        : isGate
          ? COMPONENTS.feedback
          : COMPONENTS.weekly,
    });
  }

  if (run.isolatedItemKeys.length > 0) {
    out.push({
      id: `ATT-${signal.id}-ISOLATED`,
      severity: "AMBER",
      title: `${run.isolatedItemKeys.length} item(s) were set aside as uncertain (${signal.label})`,
      meaning: "Food OS was not confident about these items, so it planned around them instead of inventing a number.",
      rootCause: `Isolated: ${run.isolatedItemKeys.join(", ")}.`,
      consequence: "Everything else was planned normally. These items need a human confirmation.",
      evidence: [`cycleId=${run.cycleId}`, `isolated=${run.isolatedItemKeys.join(",")}`],
      workItem: { ref: "RB-1", title: "Confirm uncertain stock via Quick Stock Sweep", state: "EXPECTED" },
      component: COMPONENTS.stateEngine,
    });
  }

  return out;
}

function schedulerAttention(signal: SchedulerSignal): AttentionItem[] {
  const ev = signal.result.evidence;
  if (ev.outcome === "EXECUTED") return [];

  const failedChecks = ev.checks.filter((c) => !c.passed);
  const blocked = ev.blockedActions;
  const red = ev.outcome === "REFUSED" || ev.outcome === "BLOCKED";

  return [
    {
      id: `ATT-JOB-${signal.id}`,
      severity: red ? "RED" : "AMBER",
      title:
        ev.outcome === "NO_WORK"
          ? `Scheduled wake-up found nothing to do (${signal.label})`
          : `A scheduled job did not run (${signal.label})`,
      meaning:
        ev.outcome === "NO_WORK"
          ? "The wake-up happened and correctly did nothing; there was no eligible work."
          : "The scheduler woke up, but the work it should have done was refused or blocked.",
      rootCause:
        blocked[0]?.reason ??
        failedChecks[0]?.detail ??
        ev.workPerformed,
      consequence: "No household state was changed and nothing was ordered. The job stays pending.",
      evidence: [
        `cycleId=${ev.cycleId}`,
        `outcome=${ev.outcome}`,
        `controlPlane=${ev.controlPlaneSnapshotId}`,
        `directive=${ev.directiveSelected ?? "none"}`,
        ...blocked.map((b) => `blocked: ${b.action} — ${b.reason}`),
      ],
      workItem: { ref: "RB-5", title: "Scheduled autonomous operation", state: "OPEN" },
      component: COMPONENTS.scheduler,
    },
  ];
}

function connectivityAttention(signals: DevControlSignals): AttentionItem[] {
  if (signals.connectivity.status === "CONFIGURED") return [];
  return [
    {
      id: "ATT-CONNECTOR",
      severity: "AMBER",
      title: "Food OS is not connected to the real household tables",
      meaning:
        "Everything you see is running on synthetic data. This is the intended state today, not a fault.",
      rootCause:
        signals.connectivity.status === "UNKNOWN"
          ? "Connector status could not be resolved from this surface."
          : `Connector configuration is incomplete: ${signals.connectivity.missing.join(", ") || "no credentials provisioned"}.`,
      consequence:
        "The runtime reads nothing real and can write nothing real. It never falls back to fixtures pretending to be production.",
      evidence: [`status=${signals.connectivity.status}`, signals.connectivity.detail],
      workItem: { ref: "RB-6", title: "Provision the read-only household connector", state: "EXPECTED" },
      component: COMPONENTS.productionAdapter,
    },
  ];
}

function labAttention(signals: DevControlSignals): AttentionItem[] {
  if (signals.lab.failed === 0) return [];
  const failing = signals.lab.results.filter((r) => !r.passed);
  return [
    {
      id: "ATT-LAB",
      severity: "RED",
      title: `${signals.lab.failed} live integration case(s) are failing`,
      meaning: "The replay-to-quantity pipeline is not behaving as specified right now.",
      rootCause: failing
        .flatMap((r) => r.checks.filter((c) => !c.passed).map((c) => `${r.caseId}: ${c.label} — ${c.detail}`))
        .join(" | "),
      consequence: "Treat any quantity or basket output as untrusted until this is green.",
      evidence: failing.map((r) => `${r.caseId} ${r.reconciliationStatus}`),
      workItem: { ref: "RB-3", title: "Quantities and candidate basket", state: "OPEN" },
      component: COMPONENTS.testLab,
    },
  ];
}

function jobsFrom(signals: DevControlSignals): JobRow[] {
  const rows: JobRow[] = [];
  const seen = new Set<string>();

  for (const signal of signals.scheduler) {
    const ev = signal.result.evidence;
    const selection = signal.result.selection;
    const attentionId = ev.outcome === "EXECUTED" ? null : `ATT-JOB-${signal.id}`;

    if (ev.directiveSelected) {
      seen.add(ev.directiveSelected);
      rows.push({
        id: `${signal.id}:${ev.directiveSelected}`,
        title: ev.directiveSelected,
        purpose: KIND_PURPOSE[ev.directiveKind ?? "UNSUPPORTED"] ?? "Scheduled control-plane job.",
        state: ev.outcome === "EXECUTED" ? "RAN" : ev.outcome === "BLOCKED" ? "BLOCKED" : "REFUSED",
        detail: ev.workPerformed,
        lastOutcome: ev.outcome,
        lastWakeAt: ev.wakeAt,
        cycleId: ev.cycleId,
        attentionId,
      });
    }

    if (!selection.selected) {
      for (const b of selection.blocked) {
        if (seen.has(b.directiveId)) continue;
        seen.add(b.directiveId);
        rows.push({
          id: `${signal.id}:${b.directiveId}`,
          title: b.directiveId,
          purpose: "Scheduled control-plane job.",
          state: "BLOCKED",
          detail: b.reason,
          lastOutcome: ev.outcome,
          lastWakeAt: ev.wakeAt,
          cycleId: ev.cycleId,
          attentionId,
        });
      }
      for (const id of selection.consideredIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({
          id: `${signal.id}:${id}`,
          title: id,
          purpose: "Scheduled control-plane job.",
          state: "IDLE",
          detail: "Considered by this wake-up but not selected.",
          lastOutcome: ev.outcome,
          lastWakeAt: ev.wakeAt,
          cycleId: ev.cycleId,
          attentionId: null,
        });
      }
    }
  }

  if (signals.connectivity.status !== "CONFIGURED") {
    rows.push({
      id: "CONNECTOR",
      title: "Household connector (read-only)",
      purpose: "Reads the real household event tables so cycles can run on live state.",
      state: "OFFLINE",
      detail: signals.connectivity.detail,
      lastOutcome: signals.connectivity.status,
      lastWakeAt: null,
      cycleId: null,
      attentionId: "ATT-CONNECTOR",
    });
  }

  return rows;
}

function runningFrom(signals: DevControlSignals): RunningRow[] {
  return signals.weekly.map((signal) => {
    const run = signal.run;
    const attentionIds = run.stages
      .filter((s) => s.status !== "OK" && s.status !== "SKIPPED")
      .map((s) => `ATT-${signal.id}-${s.stage}`);
    if (run.isolatedItemKeys.length > 0) attentionIds.push(`ATT-${signal.id}-ISOLATED`);

    const items = run.plan?.requirements.length ?? 0;
    const lines = run.basket?.lines.length ?? 0;
    const summary =
      run.status === "COMPLETED"
        ? `Produced ${items} quantity requirement(s) and a candidate basket of ${lines} line(s), waiting for a human.`
        : run.status === "REFUSED"
          ? "Stopped on purpose before planning; nothing was calculated downstream."
          : "A stage failed; the run stopped where the problem was found.";

    return {
      id: signal.id,
      label: signal.label,
      summary,
      status: run.status,
      stageSummary: run.stages.map((s) => ({ stage: s.stage, status: s.status, detail: s.detail })),
      cycleId: run.cycleId,
      snapshotId: run.snapshot?.snapshotId ?? null,
      replayId: run.snapshot?.replayId ?? null,
      isolatedItemKeys: [...run.isolatedItemKeys],
      approval: run.approval.reason,
      attentionIds,
    };
  });
}

function evidenceFrom(signals: DevControlSignals): EvidenceRow[] {
  const rows: EvidenceRow[] = [
    {
      id: "EV-LAB",
      label: "Live integration cases (replay → quantity)",
      passed: signals.lab.passed,
      total: signals.lab.results.length,
      green: signals.lab.failed === 0,
      detail: "Executed in this browser session against synthetic fixtures.",
      failing: signals.lab.results.filter((r) => !r.passed).map((r) => r.caseId),
    },
  ];

  const weeklyOk = signals.weekly.filter((w) => w.run.status !== "FAILED").length;
  rows.push({
    id: "EV-CYCLES",
    label: "Weekly shadow cycles executed",
    passed: weeklyOk,
    total: signals.weekly.length,
    green: weeklyOk === signals.weekly.length,
    detail: "Each scenario ran end to end without an unhandled failure.",
    failing: signals.weekly.filter((w) => w.run.status === "FAILED").map((w) => w.label),
  });

  const invariantHolds = signals.weekly.every(
    (w) => !w.run.mutatedHouseholdState && !w.run.appendedEvents && !w.run.dispatched,
  ) && signals.scheduler.every(
    (s) =>
      !s.result.evidence.mutatedHouseholdState &&
      !s.result.evidence.appendedEvents &&
      !s.result.evidence.dispatched,
  );
  rows.push({
    id: "EV-SAFETY",
    label: "Safety invariants (no writes, no orders)",
    passed: invariantHolds ? 1 : 0,
    total: 1,
    green: invariantHolds,
    detail: "Every run reported: household state unchanged, no events appended, nothing dispatched.",
    failing: invariantHolds ? [] : ["A run reported a write or dispatch"],
  });

  const schedOk = signals.scheduler.filter((s) => s.result.evidence.outcome !== "REFUSED").length;
  rows.push({
    id: "EV-SCHED",
    label: "Scheduler wake-ups producing evidence",
    passed: schedOk,
    total: signals.scheduler.length,
    green: signals.scheduler.length > 0 && schedOk === signals.scheduler.length,
    detail: "Each wake-up recorded an AGENT RUN-shaped audit row.",
    failing: signals.scheduler
      .filter((s) => s.result.evidence.outcome === "REFUSED")
      .map((s) => s.label),
  });

  return rows;
}

export function buildDevControlReport(signals: DevControlSignals): DevControlReport {
  const attention = [
    ...labAttention(signals),
    ...signals.weekly.flatMap(stageAttention),
    ...signals.scheduler.flatMap(schedulerAttention),
    ...connectivityAttention(signals),
  ];

  const reds = attention.filter((a) => a.severity === "RED");
  const ambers = attention.filter((a) => a.severity === "AMBER");
  const evidence = evidenceFrom(signals);
  const evidenceRed = evidence.some((e) => !e.green && e.id !== "EV-SCHED");

  const health: Health = reds.length > 0 || evidenceRed ? "RED" : ambers.length > 0 ? "AMBER" : "GREEN";

  const headline =
    health === "GREEN"
      ? "Food OS is healthy: every stage ran and nothing needs you right now."
      : health === "AMBER"
        ? `Food OS is working, with ${ambers.length} thing(s) waiting on you or on setup.`
        : `Food OS has ${reds.length} problem(s) stopping work right now.`;

  const bullets = [
    `${signals.weekly.length} weekly shadow cycle(s) executed; ${signals.lab.passed}/${signals.lab.results.length} live integration cases green.`,
    `${signals.scheduler.length} scheduled wake-up(s) observed; ${jobsFrom(signals).filter((j) => j.state === "BLOCKED" || j.state === "OFFLINE" || j.state === "REFUSED").length} job(s) not running.`,
    "Nothing here reads or changes your real household data — synthetic fixtures only.",
  ];

  return {
    now: signals.now,
    health,
    headline,
    bullets,
    running: runningFrom(signals),
    jobs: jobsFrom(signals),
    evidence,
    attention,
    roadmap: ROADMAP,
    shifts: SHIFTS,
    readOnly: true,
    mutatedHouseholdState: false,
    dispatched: false,
  };
}
