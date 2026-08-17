import type { HouseholdEvent } from "./state-engine/types";
import type { WakeLedgerEntry } from "./scheduler/types";
import { appendTestHouseholdEvent, readTestHouseholdState } from "./runtime-household";
import { runDeployedTestSchedulerCycle, testSchedulerWakeRunId } from "./runtime-scheduler-test";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: () => Promise<{ results: unknown[]; success: boolean; meta?: { changes?: number } }>;
  run: () => Promise<{ results: unknown[]; success: boolean; meta?: { changes?: number } }>;
};

type D1DatabaseLike = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

const SCHEDULER_WAKE_LEASE_MS = 5 * 60 * 1000;

function isHouseholdEvent(value: unknown): value is HouseholdEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === "string" &&
    event.recordClass === "Test" &&
    (event.eventType === "ITEM_STOCK_SET" ||
      event.eventType === "ITEM_STOCK_DELTA" ||
      event.eventType === "ITEM_REMOVED") &&
    typeof event.itemKey === "string" &&
    typeof event.occurredAt === "string" &&
    typeof event.payload === "object" &&
    event.payload !== null
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function schedulerCycleFirstResponse(proof: Awaited<ReturnType<typeof runDeployedTestSchedulerCycle>>) {
  if (!proof.first) throw new Error("Scheduler proof first result missing");
  const assertions = proof.assertions;
  const passed =
    assertions.highestPriorityDirective &&
    assertions.executed &&
    assertions.replayCompleted &&
    assertions.quantityRequirementsProduced > 0 &&
    assertions.basketProduced !== null &&
    assertions.approvalUnGranted &&
    assertions.mutatedHouseholdState === false &&
    assertions.appendedEvents === false &&
    assertions.dispatched === false;

  return {
    ok: passed,
    mode: "TEST_ONLY",
    phase: "FIRST",
    assertions,
    first: {
      cycleId: proof.first.evidence.cycleId,
      directiveSelected: proof.first.evidence.directiveSelected,
      outcome: proof.first.evidence.outcome,
      workPerformed: proof.first.evidence.workPerformed,
      nextHandoff: proof.first.evidence.nextHandoff,
      checks: proof.first.evidence.checks,
      mutatedHouseholdState: proof.first.evidence.mutatedHouseholdState,
      appendedEvents: proof.first.evidence.appendedEvents,
      dispatched: proof.first.evidence.dispatched,
      approvalGranted: proof.first.run?.approval.granted ?? null,
    },
  };
}

function schedulerCycleDuplicateResponse(proof: Awaited<ReturnType<typeof runDeployedTestSchedulerCycle>>) {
  if (!proof.duplicate) throw new Error("Scheduler proof duplicate result missing");
  const assertions = proof.assertions;
  const passed =
    assertions.duplicateWakeInert &&
    assertions.mutatedHouseholdState === false &&
    assertions.appendedEvents === false &&
    assertions.dispatched === false;

  return {
    ok: passed,
    mode: "TEST_ONLY",
    phase: "DUPLICATE",
    assertions,
    duplicate: {
      duplicateWakeOf: proof.duplicate.evidence.duplicateWakeOf,
      workPerformed: proof.duplicate.evidence.workPerformed,
      outcome: proof.duplicate.evidence.outcome,
      mutatedHouseholdState: proof.duplicate.evidence.mutatedHouseholdState,
      appendedEvents: proof.duplicate.evidence.appendedEvents,
      dispatched: proof.duplicate.evidence.dispatched,
    },
  };
}

/**
 * Synthetic-only family-alpha state endpoints.
 * Production household writes are deliberately rejected at the HTTP boundary.
 */
export async function runtimeHouseholdResponse(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (url.pathname === "/runtime/test/scheduler-cycle" && request.method === "POST") {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const rawWakeAt = body && typeof body === "object" ? (body as Record<string, unknown>).wakeAt : undefined;
    if (rawWakeAt !== undefined && !isIsoTimestamp(rawWakeAt)) {
      return Response.json({ ok: false, mode: "TEST_ONLY", error: "wakeAt must be a valid ISO timestamp" }, { status: 400 });
    }
    const wakeAt = typeof rawWakeAt === "string" ? rawWakeAt : "2026-08-17T00:00:00.000Z";

    try {
      const runId = testSchedulerWakeRunId(wakeAt);
      const now = Date.now();
      const prior = await db
        .prepare("SELECT evidence, created_at FROM runtime_runs WHERE run_id = ? LIMIT 1")
        .bind(runId)
        .all();
      const priorRow = prior.results[0] as { evidence?: unknown; created_at?: unknown } | undefined;

      if (typeof priorRow?.evidence === "string") {
        const evidence = JSON.parse(priorRow.evidence) as WakeLedgerEntry["evidence"] | { status?: string };
        if (evidence && typeof evidence === "object" && "status" in evidence && evidence.status === "RUNNING") {
          const createdAt = typeof priorRow.created_at === "number" ? priorRow.created_at : now;
          if (now - createdAt < SCHEDULER_WAKE_LEASE_MS) {
            return Response.json(
              { ok: false, mode: "TEST_ONLY", error: "Scheduler wake is already executing", runId },
              { status: 409 },
            );
          }

          await db
            .prepare("DELETE FROM runtime_runs WHERE run_id = ? AND created_at = ?")
            .bind(runId, createdAt)
            .run();
        } else {
          const proof = await runDeployedTestSchedulerCycle(wakeAt, [
            { cycleId: (evidence as WakeLedgerEntry["evidence"]).cycleId, evidence: evidence as WakeLedgerEntry["evidence"] },
          ]);
          return Response.json(schedulerCycleDuplicateResponse(proof));
        }
      }

      const claim = await db
        .prepare(
          `INSERT OR IGNORE INTO runtime_runs
           (run_id, task_id, agent_id, outcome, created_at, evidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          runId,
          "TEST-SCHEDULER-CYCLE",
          "scheduler-test",
          "RUNNING",
          now,
          JSON.stringify({ status: "RUNNING" }),
        )
        .run();

      if ((claim.meta?.changes ?? 0) === 0) {
        return Response.json(
          { ok: false, mode: "TEST_ONLY", error: "Scheduler wake is already executing", runId },
          { status: 409 },
        );
      }

      const proof = await runDeployedTestSchedulerCycle(wakeAt);
      if (!proof.first) throw new Error("Fresh scheduler proof did not return a first result");

      await db
        .prepare(
          `UPDATE runtime_runs
           SET outcome = ?, evidence = ?, created_at = ?
           WHERE run_id = ?`,
        )
        .bind(
          proof.first.evidence.outcome,
          JSON.stringify(proof.first.evidence),
          now,
          runId,
        )
        .run();

      return Response.json(schedulerCycleFirstResponse(proof));
    } catch (error) {
      console.error(error);
      return Response.json(
        { ok: false, mode: "TEST_ONLY", error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  }

  if (url.pathname === "/runtime/household/state" && request.method === "GET") {
    try {
      const result = await readTestHouseholdState(db);
      return Response.json({
        ok: true,
        mode: "TEST_ONLY",
        eventCount: result.eventCount,
        snapshot: result.snapshot,
      });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Household state replay failed" }, { status: 500 });
    }
  }

  if (url.pathname === "/runtime/household/events" && request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!isHouseholdEvent(body)) {
      return Response.json(
        {
          ok: false,
          error: "Only well-formed Record class = Test household events are accepted by the runtime alpha boundary",
        },
        { status: 400 },
      );
    }

    try {
      const result = await appendTestHouseholdEvent(db, body);
      return Response.json({
        ok: true,
        mode: "TEST_ONLY",
        appended: result.appended,
        duplicate: result.duplicate,
        conflict: result.conflict,
        eventId: result.eventId,
        snapshot: result.snapshot,
      });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Household event append failed" }, { status: 500 });
    }
  }

  return undefined;
}
