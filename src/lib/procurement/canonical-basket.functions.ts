import { createServerFn } from "@tanstack/react-start";
import type { FetchLike } from "../production-adapter/airtable-rest-source";
import { readCanonicalBasketForShop } from "./canonical-basket";

export const getCanonicalBasketForShop = createServerFn({ method: "GET" }).handler(async () => {
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

  return readCanonicalBasketForShop(env, fetch as unknown as FetchLike);
});
