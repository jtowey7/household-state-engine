import { createServerFn } from "@tanstack/react-start";

/**
 * Read-only live household-state summary for operator surfaces.
 * Returns counts and provenance only — never rows, never credentials, and
 * never synthetic data disguised as live household state.
 */
export const getLiveHouseholdState = createServerFn({ method: "GET" }).handler(async () => {
  const { readLiveHouseholdSummary } = await import("./live-read");
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return readLiveHouseholdSummary({
    env: process.env as Record<string, string | undefined>,
    scope: { datasetId: "household", windowStart: start, windowEnd: end },
  });
});
