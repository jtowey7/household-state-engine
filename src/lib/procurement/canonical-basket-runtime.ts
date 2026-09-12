import { persistCanonicalBasketCandidate } from "./canonical-basket-writer";
import type { CandidateBasket } from "./types";

export const CANONICAL_BASKET_RUNTIME_PATH = "/runtime/basket/candidate" as const;
export const CANONICAL_BASKET_RUNTIME_TOKEN_KEY = "FOODOS_BASKET_WRITE_TOKEN" as const;

export interface CanonicalBasketRuntimeD1Statement {
  bind: (...values: unknown[]) => CanonicalBasketRuntimeD1Statement;
}

export interface CanonicalBasketRuntimeD1Database {
  prepare: (sql: string) => CanonicalBasketRuntimeD1Statement;
  batch: (statements: CanonicalBasketRuntimeD1Statement[]) => Promise<
    { meta?: { changes?: number } }[]
  >;
}

export interface CanonicalBasketRuntimeEnvironment {
  AIRTABLE_API_KEY?: string;
  AIRTABLE_FOOD_OS_BASE_ID?: string;
  FOODOS_BASKET_WRITE_TOKEN?: string;
  FOODOS_RUNTIME_TEST?: CanonicalBasketRuntimeD1Database;
}

export interface CanonicalBasketRuntimeConfig {
  apiKey: string;
  baseId: string;
  writeToken: string;
  runtimeDatabase?: CanonicalBasketRuntimeD1Database;
}

export type CanonicalBasketRuntimeFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveCanonicalBasketRuntimeConfig(
  env: CanonicalBasketRuntimeEnvironment,
): CanonicalBasketRuntimeConfig | undefined {
  if (
    !nonEmpty(env.AIRTABLE_API_KEY) ||
    !nonEmpty(env.AIRTABLE_FOOD_OS_BASE_ID) ||
    !nonEmpty(env.FOODOS_BASKET_WRITE_TOKEN)
  ) {
    return undefined;
  }

  return {
    apiKey: env.AIRTABLE_API_KEY.trim(),
    baseId: env.AIRTABLE_FOOD_OS_BASE_ID.trim(),
    writeToken: env.FOODOS_BASKET_WRITE_TOKEN.trim(),
    runtimeDatabase: env.FOODOS_RUNTIME_TEST,
  };
}

async function getBoundRuntimeDatabase(): Promise<CanonicalBasketRuntimeD1Database | undefined> {
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    return cloudflareWorkers.env?.['FOODOS_RUNTIME_TEST'] as CanonicalBasketRuntimeD1Database | undefined;
  } catch {
    return undefined;
  }
}

function unauthorized(): Response {
  return Response.json(
    { ok: false, mode: "CANONICAL_BASKET_WRITE", error: "Basket write authorization failed" },
    { status: 401 },
  );
}

const BASKET_LOCK_LEASE_MS = 5 * 60 * 1000;
const BASKET_LOCK_HEARTBEAT_MS = 60 * 1000;

type BasketWriteLock = {
  runId: string;
  release: () => Promise<void>;
};

async function acquireBasketWriteLock(
  db: CanonicalBasketRuntimeD1Database,
  basketId: string,
): Promise<BasketWriteLock | undefined> {
  const taskId = `BASKET-WRITE:${basketId}`;
  const runId = `basket-write:${crypto.randomUUID()}`;
  const agentId = "canonical-basket-runtime";
  const now = Date.now();
  const leaseExpiresAt = now + BASKET_LOCK_LEASE_MS;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE runtime_tasks
         SET status = 'READY', claimed_by = NULL, claim_run_id = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE task_id = ? AND task_class = 'TEST' AND status = 'CLAIMED'
           AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
      )
      .bind(now, taskId, now),
    db
      .prepare(
        `DELETE FROM runtime_claims
         WHERE task_id = ? AND lease_expires_at <= ?`,
      )
      .bind(taskId, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO runtime_tasks
         (task_id, status, task_class, directive, updated_at)
         VALUES (?, 'READY', 'TEST', ?, ?)`,
      )
      .bind(taskId, "Serialize canonical BASKET CANDIDATES writes per Basket ID.", now),
    db
      .prepare(
        `UPDATE runtime_tasks
         SET status = 'CLAIMED', claimed_by = ?, claim_run_id = ?, lease_expires_at = ?, updated_at = ?
         WHERE task_id = ? AND status = 'READY' AND task_class = 'TEST'`,
      )
      .bind(agentId, runId, leaseExpiresAt, now, taskId),
    db
      .prepare(
        `INSERT INTO runtime_claims
         (claim_id, task_id, run_id, agent_id, claimed_at, lease_expires_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM runtime_tasks
           WHERE task_id = ? AND status = 'CLAIMED' AND claim_run_id = ?
         )`,
      )
      .bind(crypto.randomUUID(), taskId, runId, agentId, now, leaseExpiresAt, taskId, runId),
  ]);

  if ((results[3]?.meta?.changes ?? 0) !== 1) return undefined;

  return {
    runId,
    release: async () => {
      await db.batch([
        db
          .prepare(
            `UPDATE runtime_tasks
             SET status = 'READY', claimed_by = NULL, claim_run_id = NULL, lease_expires_at = NULL, updated_at = ?
             WHERE task_id = ? AND task_class = 'TEST' AND claim_run_id = ?`,
          )
          .bind(Date.now(), taskId, runId),
        db
          .prepare("DELETE FROM runtime_claims WHERE task_id = ? AND run_id = ?")
          .bind(taskId, runId),
      ]);
    },
  };
}

async function renewBasketWriteLock(
  db: CanonicalBasketRuntimeD1Database,
  basketId: string,
  runId: string,
): Promise<boolean> {
  const now = Date.now();
  const leaseExpiresAt = now + BASKET_LOCK_LEASE_MS;
  const taskId = `BASKET-WRITE:${basketId}`;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE runtime_tasks
         SET lease_expires_at = ?, updated_at = ?
         WHERE task_id = ? AND task_class = 'TEST' AND status = 'CLAIMED' AND claim_run_id = ?`,
      )
      .bind(leaseExpiresAt, now, taskId, runId),
    db
      .prepare(
        `UPDATE runtime_claims
         SET lease_expires_at = ?
         WHERE task_id = ? AND run_id = ?`,
      )
      .bind(leaseExpiresAt, taskId, runId),
  ]);

  return (results[0]?.meta?.changes ?? 0) === 1;
}

/**
 * Server-side bridge for the canonical basket writer.
 *
 * SAFETY BOUNDARY:
 * - requires a dedicated runtime write token; read tokens are not accepted;
 * - requires server-side Airtable credentials; they never cross the response boundary;
 * - serializes writes per Basket ID through TEST-only D1 runtime claims before the
 *   Airtable read/check/write sequence, closing the GET→POST concurrency race;
 * - renews the D1 lease while the Airtable operation is in flight; a failed renewal
 *   now aborts the in-flight Airtable request rather than allowing a stale writer to
 *   survive past its fencing window;
 * - writes only BASKET CANDIDATES through persistCanonicalBasketCandidate;
 * - never writes HOUSEHOLD EVENTS, INVENTORY, SHOPPING orders or retailer state;
 * - missing configuration fails closed rather than falling back to synthetic data.
 */
export async function canonicalBasketRuntimeResponse(
  request: Request,
  env: CanonicalBasketRuntimeEnvironment,
  fetchImpl: CanonicalBasketRuntimeFetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== CANONICAL_BASKET_RUNTIME_PATH || request.method !== "POST") return undefined;

  const config = resolveCanonicalBasketRuntimeConfig(env);
  if (!config) {
    return Response.json(
      {
        ok: false,
        mode: "CANONICAL_BASKET_WRITE",
        error: "Canonical basket writer not configured",
        missing: [
          !nonEmpty(env.AIRTABLE_API_KEY) ? "AIRTABLE_API_KEY" : null,
          !nonEmpty(env.AIRTABLE_FOOD_OS_BASE_ID) ? "AIRTABLE_FOOD_OS_BASE_ID" : null,
          !nonEmpty(env.FOODOS_BASKET_WRITE_TOKEN) ? "FOODOS_BASKET_WRITE_TOKEN" : null,
        ].filter((value): value is string => value !== null),
      },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${config.writeToken}`) return unauthorized();

  let body: { basket?: unknown; runId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, mode: "CANONICAL_BASKET_WRITE", error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!body.basket || typeof body.basket !== "object") {
    return Response.json(
      { ok: false, mode: "CANONICAL_BASKET_WRITE", error: "basket is required" },
      { status: 400 },
    );
  }

  const basket = body.basket as CandidateBasket;
  const runtimeDatabase = config.runtimeDatabase ?? (await getBoundRuntimeDatabase());
  if (!runtimeDatabase) {
    return Response.json(
      {
        ok: false,
        mode: "CANONICAL_BASKET_WRITE",
        error: "Canonical basket concurrency guard unavailable",
      },
      { status: 503 },
    );
  }

  const lock = await acquireBasketWriteLock(runtimeDatabase, basket.basketId);
  if (!lock) {
    return Response.json(
      {
        ok: false,
        mode: "CANONICAL_BASKET_WRITE",
        status: "REFUSED",
        detail: `BASKET_WRITE_BUSY: Basket ${basket.basketId} is already being persisted by another runtime request; refusing concurrent write.`,
      },
      { status: 409 },
    );
  }

  const abortController = new AbortController();
  let leaseHealthy = true;
  const heartbeat = setInterval(() => {
    void renewBasketWriteLock(runtimeDatabase, basket.basketId, lock.runId)
      .then((renewed) => {
        if (!renewed) {
          leaseHealthy = false;
          abortController.abort();
        }
      })
      .catch(() => {
        leaseHealthy = false;
        abortController.abort();
      });
  }, BASKET_LOCK_HEARTBEAT_MS);

  const abortableFetch = (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) =>
    (fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>)(input, {
      ...init,
      signal: abortController.signal,
    });

  try {
    const runId = nonEmpty(body.runId) ? body.runId.trim() : undefined;
    const result = await persistCanonicalBasketCandidate(
      config,
      basket,
      abortableFetch,
      runId,
    );

    if (!leaseHealthy) {
      return Response.json(
        {
          ok: false,
          mode: "CANONICAL_BASKET_WRITE",
          status: "REFUSED",
          detail: `BASKET_WRITE_LEASE_LOST: Basket ${basket.basketId} write was aborted because the runtime lock could not be renewed.`,
        },
        { status: 503 },
      );
    }

    if (result.status === "REFUSED") {
      return Response.json(
        { ok: false, mode: "CANONICAL_BASKET_WRITE", ...result },
        { status: 422 },
      );
    }

    return Response.json(
      { ok: true, mode: "CANONICAL_BASKET_WRITE", ...result },
      { status: result.status === "PERSISTED" ? 201 : 200 },
    );
  } finally {
    clearInterval(heartbeat);
    await lock.release();
  }
}
