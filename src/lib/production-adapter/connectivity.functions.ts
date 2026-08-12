import { createServerFn } from "@tanstack/react-start";

/**
 * Read-only connectivity status for the Airtable HOUSEHOLD EVENTS connector.
 * Returns configuration presence only — never credential values, never rows.
 */
export const getAirtableConnectivity = createServerFn({ method: "GET" }).handler(async () => {
  const { resolveAirtableConfig, describeAirtableConnectivity } = await import(
    "./airtable-rest-source"
  );
  const resolution = resolveAirtableConfig(process.env as Record<string, string | undefined>);
  return {
    status: resolution.status,
    missing: resolution.missing,
    detail: describeAirtableConnectivity(resolution),
  };
});
