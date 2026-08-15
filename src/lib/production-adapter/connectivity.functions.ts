import { createServerFn } from "@tanstack/react-start";

/**
 * Read-only connectivity status for the Airtable HOUSEHOLD EVENTS connector.
 * Returns configuration presence only — never credential values, never rows.
 */
export const getAirtableConnectivity = createServerFn({ method: "GET" }).handler(async () => {
  const { resolveAirtableConfig, describeAirtableConnectivity } = await import(
    "./airtable-rest-source"
  );
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
  const resolution = resolveAirtableConfig(env);
  return {
    status: resolution.status,
    missing: resolution.missing,
    detail: describeAirtableConnectivity(resolution),
  };
});
