import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeaders, setResponseStatus } from "@tanstack/react-start/server";

import { createOperatorSession } from "./operator-read-auth";
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
    const headers = new Headers();
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) headers.set("set-cookie", setCookie);
    headers.set("cache-control", "no-store");
    setResponseHeaders(headers);
    return (await response.json()) as { ok: boolean; error?: string; expiresAt?: string };
  });

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
      headers: cookie ? { cookie } : undefined,
    }),
    env,
  );
  if (!response) throw new Error("Operator weekly planning endpoint unavailable");
  setResponseStatus(response.status);
  setResponseHeaders(new Headers({ "cache-control": "private, no-store" }));
  return (await response.json()) as Record<string, unknown>;
});
