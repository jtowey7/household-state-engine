import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type D1Result = { results: unknown[]; success: boolean; meta?: { changes?: number } };
type D1Statement = { bind: (...values: unknown[]) => D1Statement; all: () => Promise<D1Result>; run: () => Promise<D1Result> };
type D1DatabaseLike = { prepare: (sql: string) => D1Statement; batch: (statements: D1Statement[]) => Promise<D1Result[]> };
type RuntimeEnv = { FOODOS_RUNTIME_TEST?: D1DatabaseLike };

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function runtimeResponse(request: Request, env: RuntimeEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/runtime/")) return undefined;

  const db = env.FOODOS_RUNTIME_TEST;
  if (!db) {
    return Response.json({ ok: false, error: "FOODOS_RUNTIME_TEST binding unavailable" }, { status: 503 });
  }

  if (url.pathname === "/runtime/health" && request.method === "GET") {
    try {
      const result = await db.prepare("SELECT 1 AS ok").all();
      return Response.json({ ok: true, database: "FOODOS_RUNTIME_TEST", probe: result.results });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "D1 health probe failed" }, { status: 503 });
    }
  }

  if (url.pathname === "/runtime/claim" && request.method === "POST") {
    let body: { taskId?: string; runId?: string; agentId?: string; leaseSeconds?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const taskId = body.taskId?.trim();
    const runId = body.runId?.trim();
    const agentId = body.agentId?.trim();
    const leaseSeconds = Math.max(60, Math.min(3600, Math.floor(body.leaseSeconds ?? 900)));

    if (!taskId || !runId || !agentId) {
      return Response.json({ ok: false, error: "taskId, runId and agentId are required" }, { status: 400 });
    }

    const now = Date.now();
    const expiresAt = now + leaseSeconds * 1000;

    try {
      const results = await db.batch([
        db.prepare(
          `UPDATE runtime_tasks
           SET status = 'READY', claimed_by = NULL, claim_run_id = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE status = 'CLAIMED'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`
        ).bind(now, now),
        db.prepare("DELETE FROM runtime_claims WHERE lease_expires_at <= ?").bind(now),
        db.prepare(
          `INSERT OR IGNORE INTO runtime_claims
             (claim_id, task_id, run_id, agent_id, claimed_at, lease_expires_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM runtime_tasks
             WHERE task_id = ? AND status = 'READY' AND task_class = 'TEST'
           )
             AND NOT EXISTS (SELECT 1 FROM runtime_claims WHERE task_id = ?)
             AND NOT EXISTS (SELECT 1 FROM runtime_claims WHERE run_id = ?)`
        ).bind(crypto.randomUUID(), taskId, runId, agentId, now, expiresAt, taskId, taskId, runId),
        db.prepare(
          `UPDATE runtime_tasks
           SET status = 'CLAIMED', claimed_by = ?, claim_run_id = ?, lease_expires_at = ?, updated_at = ?
           WHERE task_id = ?
             AND status = 'READY'
             AND task_class = 'TEST'
             AND EXISTS (SELECT 1 FROM runtime_claims WHERE task_id = ? AND run_id = ?)`
        ).bind(agentId, runId, expiresAt, now, taskId, taskId, runId),
      ]);

      const claimChange = results[2]?.meta?.changes ?? 0;
      const duplicateRun = await db
        .prepare("SELECT 1 AS present FROM runtime_claims WHERE run_id = ? LIMIT 1")
        .bind(runId)
        .all();

      if (claimChange === 0) {
        return Response.json({
          ok: true,
          claimed: false,
          reason: duplicateRun.results.length ? "already_claimed" : "task_unavailable",
          taskId,
          runId,
        });
      }

      return Response.json({
        ok: true,
        claimed: true,
        taskId,
        runId,
        agentId,
        leaseExpiresAt: new Date(expiresAt).toISOString(),
      });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Claim transaction failed" }, { status: 500 });
    }
  }

  if (url.pathname === "/runtime/run" && request.method === "POST") {
    let body: { runId?: string; taskId?: string; agentId?: string; outcome?: string; evidence?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const runId = body.runId?.trim();
    const taskId = body.taskId?.trim();
    const agentId = body.agentId?.trim();
    const outcome = body.outcome?.trim();
    const evidence = body.evidence?.trim();

    if (!runId || !taskId || !agentId || !outcome || !evidence) {
      return Response.json(
        { ok: false, error: "runId, taskId, agentId, outcome and evidence are required" },
        { status: 400 },
      );
    }

    try {
      const testTask = await db
        .prepare("SELECT task_class FROM runtime_tasks WHERE task_id = ? LIMIT 1")
        .bind(taskId)
        .all();
      const task = testTask.results[0] as { task_class?: string } | undefined;

      if (!task) {
        return Response.json({ ok: false, error: "Runtime task not found" }, { status: 404 });
      }
      if (task.task_class !== "TEST") {
        return Response.json({ ok: false, error: "Runtime evidence is restricted to TEST tasks" }, { status: 403 });
      }

      const createdAt = Date.now();
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO runtime_runs
             (run_id, task_id, agent_id, outcome, created_at, evidence)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(runId, taskId, agentId, outcome, createdAt, evidence)
        .run();

      const created = (result.meta?.changes ?? 0) > 0;
      return Response.json({ ok: true, created, idempotent: !created, runId, taskId });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Runtime evidence persistence failed" }, { status: 500 });
    }
  }

  return Response.json({ ok: false, error: "Unknown runtime endpoint" }, { status: 404 });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const runtime = await runtimeResponse(request, env as RuntimeEnv);
      if (runtime) return runtime;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
