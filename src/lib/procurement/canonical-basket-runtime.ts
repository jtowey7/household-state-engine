import { persistCanonicalBasketCandidate } from "./canonical-basket-writer";
import type { CandidateBasket } from "./types";

export const CANONICAL_BASKET_RUNTIME_PATH = "/runtime/basket/candidate" as const;
export const CANONICAL_BASKET_RUNTIME_TOKEN_KEY = "FOODOS_BASKET_WRITE_TOKEN" as const;

export interface CanonicalBasketRuntimeEnvironment {
  AIRTABLE_API_KEY?: string;
  AIRTABLE_FOOD_OS_BASE_ID?: string;
  FOODOS_BASKET_WRITE_TOKEN?: string;
}

export interface CanonicalBasketRuntimeConfig {
  apiKey: string;
  baseId: string;
  writeToken: string;
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
  };
}

function unauthorized(): Response {
  return Response.json(
    { ok: false, mode: "CANONICAL_BASKET_WRITE", error: "Basket write authorization failed" },
    { status: 401 },
  );
}

/**
 * Server-side bridge for the canonical basket writer.
 *
 * SAFETY BOUNDARY:
 * - requires a dedicated runtime write token; read tokens are not accepted;
 * - requires server-side Airtable credentials; they never cross the response boundary;
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

  const runId = nonEmpty(body.runId) ? body.runId.trim() : undefined;
  const result = await persistCanonicalBasketCandidate(
    config,
    body.basket as CandidateBasket,
    fetchImpl,
    runId,
  );

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
}
