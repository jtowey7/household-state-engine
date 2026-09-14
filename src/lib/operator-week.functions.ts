import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

import { createOperatorSession, missingServerConfiguration, normaliseAccessCode } from "./operator-read-auth";
import { operatorWeekResponse } from "./operator-week-response";

export const startOperatorSession = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const cloudflareEnv: Record<string, string | undefined> = {};
    try {
      const cloudflareWorkers = (await import("cloudflare:workers")) as {
        env?: Record<string, unknown>;
      };
      for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
        if (typeof value === "string") cloudflareEnv[key] = value;
      }
    } catch {
      // Local/test execution falls back to process.env below.
    }

    const env = {
      ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)),
      ...cloudflareEnv,
    };
    const response = await createOperatorSession(data.token, env);
    setResponseStatus(response.status);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) setResponseHeader("Set-Cookie", setCookie);
    setResponseHeader("Cache-Control", "no-store");
    return (await response.json()) as { ok: boolean; error?: string; detail?: string; code?: string; missingConfiguration?: string[]; expiresAt?: string };
  });

/**
 * Safe deployment diagnostic. It reports only whether the running deployment
 * can see each required binding and whether two runtime sources disagree about
 * the access code. It never returns a value, a hash, a length or any fragment
 * of a secret, so it is safe to call from the connect screen.
 */
export const getOperatorConnectionDiagnostics = createServerFn({ method: "GET" }).handler(async () => {
  const processEnv = typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>);
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
      if (typeof value === "string") cloudflareEnv[key] = value;
    }
  } catch {
    // Local/test execution has no worker bindings.
  }

  const env = { ...processEnv, ...cloudflareEnv };
  const fromProcess = processEnv['FOODOS_OPERATOR_READ_TOKEN'];
  const fromWorker = cloudflareEnv['FOODOS_OPERATOR_READ_TOKEN'];
  const sources: string[] = [];
  if (typeof fromWorker === "string" && fromWorker.trim().length > 0) sources.push("deployment bindings");
  if (typeof fromProcess === "string" && fromProcess.trim().length > 0) sources.push("server environment");

  const conflicting =
    sources.length === 2 && normaliseAccessCode(fromProcess ?? "") !== normaliseAccessCode(fromWorker ?? "");

  setResponseHeader("Cache-Control", "no-store");
  return {
    accessCodeConfigured: sources.length > 0,
    accessCodeSources: sources,
    conflictingAccessCodeSources: conflicting,
    missingConfiguration: missingServerConfiguration(env),
  };
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type OperatorWeekPayload = { [key: string]: JsonValue };

export const getOperatorWeek = createServerFn({ method: "GET" }).handler(async () => {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
      if (typeof value === "string") cloudflareEnv[key] = value;
    }
  } catch {
    // Local/test execution falls back to process.env below.
  }

  const env = {
    ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)),
    ...cloudflareEnv,
  };
  const cookie = getRequestHeader("cookie") ?? "";
  const response = await operatorWeekResponse(
    new Request("https://foodos.local/runtime/operator/week", {
      method: "GET",
      ...(cookie ? { headers: { cookie } } : {}),
    }),
    env,
  );
  if (!response) throw new Error("Operator weekly planning endpoint unavailable");
  // Read-only: always answer 200 and let the payload's ok/error fields drive the
  // UI, so a not-yet-connected deployment shows the connect card, not an error page.
  setResponseHeader("Cache-Control", "private, no-store");
  return (await response.json()) as OperatorWeekPayload;
});
