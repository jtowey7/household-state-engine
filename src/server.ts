import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { buildLiveBaselineManifest } from "./lib/production-adapter/live-baseline-manifest";
import { createEvidenceAwareAirtableProductionPort } from "./lib/production-adapter/evidence-aware-port";
import { createAirtableRestRowSource, resolveAirtableConfig, type FetchLike } from "./lib/production-adapter/airtable-rest-source";
import { loadProductionState } from "./lib/production-adapter/adapter";
import { replayEvents, toQuantityRequirementsHandoff } from "./lib/state-engine/engine";
import { runtimeHouseholdResponse } from "./lib/runtime-household-response";

type ServerEntry = {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response> | Response;
};

type D1Result = { results: unknown[]; success: boolean; meta?: { changes?: number } };
type D1Statement = { bind: (...values: unknown[]) => D1Statement; all: () => Promise<D1Result>; run: () => Promise<D1Result> };
type D1DatabaseLike = { prepare: (sql: string) => D1Statement; batch: (statements: D1Statement[]) => Promise<D1Result[]> };

type WorkerEnvironment = Record<string, unknown>;

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function getCloudflareEnvironment(): Promise<WorkerEnvironment | undefined> {
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: WorkerEnvironment;
    };
    return cloudflareWorkers.env;
  } catch {
    return undefined;
  }
}

function readStringBinding(env: WorkerEnvironment | undefined, key: string): string | undefined {
  const value = env?.[key];
  return typeof value === "string" ? value : undefined;
}

function buildAirtableRequestEnvironment(
  cloudflareEnv: WorkerEnvironment | undefined,
  workerEnv: WorkerEnvironment | undefined,
): Record<string, string | undefined> {
  const keys = ["AIRTABLE_API_KEY", "AIRTABLE_FOOD_OS_BASE_ID", "AIRTABLE_HOUSEHOLD_EVENTS_TABLE"];
  const resolved: Record<string, string | undefined> = {};

  for (const key of keys) {
    resolved[key] = readStringBinding(workerEnv, key) ?? readStringBinding(cloudflareEnv, key);
  }

  return resolved;
}

async function getRuntimeDatabase(): Promise<D1DatabaseLike | undefined> {
  const cloudflareEnvironment = await getCloudflareEnvironment();
  return cloudflareEnvironment?.FOODOS_RUNTIME_TEST as D1DatabaseLike | undefined;
}

function parseRequiredIsoDate(value: string | null, name: string): string {
  if (!value) throw new Error(`Missing required query parameter: ${name}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ISO timestamp for ${name}`);
  return value;
}

/**
 * Read-only Production replay seam. It reads HOUSEHOLD EVENTS through the
 * GET-only Airtable adapter, maps them through the production safety boundary,
 * replays them with an injected fixed clock, and returns the state snapshot and
 * QUANTITY REQUIREMENTS handoff. There is deliberately no write path here.
 */
async function productionReplayResponse(
  request: Request,
  cloudflareEnv: WorkerEnvironment | undefined,
  workerEnv: WorkerEnvironment | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/runtime/production/replay" || request.method !== "GET") return undefined;

  try {
    const windowStart = parseRequiredIsoDate(url.searchParams.get("windowStart"), "windowStart");
    const windowEnd = parseRequiredIsoDate(url.searchParams.get("windowEnd"), "windowEnd");
    const replayClock = parseRequiredIsoDate(url.searchParams.get("replayClock"), "replayClock");
    const datasetId = url.searchParams.get("datasetId")?.trim() || "FoodOS Production HOUSEHOLD EVENTS";

    if (new Date(windowStart).getTime() > new Date(windowEnd).getTime()) {
      return Response.json({ ok: false, error: "windowStart must be <= windowEnd" }, { status: 400 });
    }

    const env = buildAirtableRequestEnvironment(cloudflareEnv, workerEnv);
    const resolution = resolveAirtableConfig(env);
    if (resolution.status !== "CONFIGURED") {
      return Response.json(
        { ok: false, mode: "PRODUCTION_READ_ONLY", error: `Airtable connector not configured (missing: ${resolution.missing.join(", ")})` },
        { status: 503 },
      );
    }

    const fetchImpl = fetch as unknown as FetchLike;
    const source = createAirtableRestRowSource({
      config: resolution.config,
      fetchImpl,
      provenance: `airtable read-only GET ${resolution.config.baseId}/${resolution.config.eventsTable}`,
    });
    const port = createEvidenceAwareAirtableProductionPort({
      source,
      mode: "PRODUCTION_READ_ONLY",
      portId: "airtable-production-household-events",
    });
    const scope = {
      mode: "PRODUCTION_READ_ONLY" as const,
      datasetId,
      windowStart,
      windowEnd,
    };
    const loaded = await loadProductionState(port, scope);
    if (!loaded.ok) {
      return Response.json(
        {
          ok: false,
          mode: "PRODUCTION_READ_ONLY",
          sourceId: loaded.sourceId,
          rejections: loaded.rejections,
        },
        { status: 502 },
      );
    }

    const snapshot = replayEvents(loaded.openingEvents, { now: () => replayClock });
    const handoff = toQuantityRequirementsHandoff(snapshot);

    return Response.json({
      ok: true,
      mode: "PRODUCTION_READ_ONLY",
      scope,
      sourceId: loaded.sourceId,
      sourceEventCount: loaded.openingEvents.length,
      quarantinedItemKeys: loaded.quarantinedItemKeys,
      sourceRejections: loaded.rejections,
      snapshot,
      quantityRequirementsHandoff: handoff,
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, mode: "PRODUCTION_READ_ONLY", error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

async function runtimeResponse(request: Request, workerEnv?: unknown): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (url.pathname === "/runtime/baseline/manifest" && request.method === "GET") {
    try {
      const boundEnv = await getCloudflareEnvironment();
      const env = buildAirtableRequestEnvironment(boundEnv, workerEnv as WorkerEnvironment | undefined);
      const manifest = await buildLiveBaselineManifest(env);
      return Response.json(manifest);
    } catch (error) {
      console.error(error);
      return Response.json(
        { ok: false, mode: "READ_ONLY", error: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  }

  const cloudflareEnv = await getCloudflareEnvironment();
  const productionReplay = await productionReplayResponse(
    request,
    cloudflareEnv,
    workerEnv as WorkerEnvironment | undefined,
  );
  if (productionReplay) return productionReplay;

  if (!url.pathname.startsWith("/runtime/")) return undefined;

  const db = await getRuntimeDatabase();
  if (!db) {
    return Response.json({ ok: false, error: "FOODOS_RUNTIME_TEST binding unavailable" }, { status: 503 });
  }

  const household = await runtimeHouseholdResponse(request, db);
  if (household) return household;

  if (url.pathname === "/runtime/health" && request.method === "GET") {
    try {
      const result = await db.prepare("SELECT 1 AS ok").all();
      return Response.json({ ok: true, database: "FOODOS_RUNTIME_TEST", probe: result.results });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "D1 health probe failed" }, { status: 503 });
    }
  }

  if (url.pathname === "/runtime/test/reset" && request.method === "POST") {
    try {
      const taskId = "CLOUDFLARE-01-SYNTHETIC";
      const task = await db
        .prepare("SELECT task_class FROM runtime_tasks WHERE task_id = ? LIMIT 1")
        .bind(taskId)
        .all();
      const row = task.results[0] as { task_class?: string } | undefined;
      if (row?.task_class !== "TEST") {
        return Response.json({ ok: false, error: "Synthetic test task is unavailable" }, { status: 404 });
      }

      await db.batch([
        db
          .prepare(
            `UPDATE runtime_tasks
             SET status = 'READY', claimed_by = NULL, claim_run_id = NULL, lease_expires_at = NULL, updated_at = ?
             WHERE task_id = ? AND task_class = 'TEST'`,
          )
          .bind(Date.now(), taskId),
        db.prepare("DELETE FROM runtime_claims WHERE task_id = ?").bind(taskId),
      ]);

      return Response.json({ ok: true, mode: "TEST_ONLY", taskId, status: "READY" });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Synthetic test reset failed" }, { status: 500 });
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
      await db.batch([
        db.prepare(
          `UPDATE runtime_tasks
           SET status = 'READY', claimed_by = NULL, claim_run_id = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE status = 'CLAIMED'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`,
        ).bind(now, now),
        db.prepare("DELETE FROM runtime_claims WHERE lease_expires_at <= ?").bind(now),
      ]);

      const results = await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO runtime_claims
             (claim_id, task_id, run_id, agent_id, claimed_at, lease_expires_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM runtime_tasks
             WHERE task_id = ? AND status = 'READY' AND task_class = 'TEST'
           )
             AND NOT EXISTS (SELECT 1 FROM runtime_claims WHERE task_id = ?)
             AND NOT EXISTS (SELECT 1 FROM runtime_claims WHERE run_id = ?)`,
        ).bind(crypto.randomUUID(), taskId, runId, agentId, now, expiresAt, taskId, taskId, runId),
        db.prepare(
          `UPDATE runtime_tasks
           SET status = 'CLAIMED', claimed_by = ?, claim_run_id = ?, lease_expires_at = ?, updated_at = ?
           WHERE task_id = ?
             AND status = 'READY'
             AND task_class = 'TEST'
             AND EXISTS (SELECT 1 FROM runtime_claims WHERE task_id = ? AND run_id = ?)`,
        ).bind(agentId, runId, expiresAt, now, taskId, taskId, runId),
      ]);

      const claimChange = results[0]?.meta?.changes ?? 0;
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
      const existingRun = await db
        .prepare("SELECT task_id, agent_id FROM runtime_runs WHERE run_id = ? LIMIT 1")
        .bind(runId)
        .all();
      const existing = existingRun.results[0] as { task_id?: string; agent_id?: string } | undefined;
      if (existing) {
        if (existing.task_id !== taskId || existing.agent_id !== agentId) {
          return Response.json({ ok: false, error: "Run identity conflict" }, { status: 409 });
        }
        return Response.json({ ok: true, created: false, idempotent: true, runId, taskId });
      }

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
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM runtime_claims c
             JOIN runtime_tasks t ON t.task_id = c.task_id
             WHERE c.run_id = ?
               AND c.task_id = ?
               AND c.agent_id = ?
               AND c.lease_expires_at > ?
               AND t.status = 'CLAIMED'
               AND t.claim_run_id = ?
               AND t.claimed_by = ?
           )`,
        )
        .bind(runId, taskId, agentId, outcome, createdAt, evidence, runId, taskId, agentId, createdAt, runId, agentId)
        .run();

      const created = (result.meta?.changes ?? 0) > 0;
      if (!created) {
        return Response.json(
          { ok: false, error: "Runtime claim is no longer active; stale worker rejected" },
          { status: 409 },
        );
      }

      return Response.json({ ok: true, created: true, idempotent: false, runId, taskId });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Runtime evidence persistence failed" }, { status: 500 });
    }
  }

  return Response.json({ ok: false, error: "Unknown runtime endpoint" }, { status: 404 });
}

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
      const runtime = await runtimeResponse(request, env);
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
