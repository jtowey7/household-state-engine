/**
 * Food OS — household data-source projection for the Control dashboard.
 *
 * Pure. Its only job is to state, unambiguously, whether the figures on screen
 * come from the real read-only HOUSEHOLD EVENTS connector or from the
 * synthetic harness. Synthetic data is never described as live household
 * state.
 */

import type { LiveHouseholdRead } from "../production-adapter/live-read";

export interface HouseholdSourceView {
  /** LIVE only when a real read-only connector read actually succeeded. */
  mode: "LIVE" | "NOT_CONFIGURED" | "READ_FAILED";
  /** True when everything else on the dashboard is synthetic harness output. */
  syntheticFigures: boolean;
  badge: string;
  title: string;
  detail: string;
  /** Secondary evidence lines (counts, ids, missing configuration keys). */
  facts: string[];
}

export function describeHouseholdSource(read: LiveHouseholdRead): HouseholdSourceView {
  if (read.status === "LIVE") {
    const s = read.summary;
    return {
      mode: "LIVE",
      syntheticFigures: false,
      badge: "LIVE · READ-ONLY",
      title: "Reading the real household event log.",
      detail: read.detail,
      facts: [
        `${s.eventCount} household event(s) in ${s.windowStart} → ${s.windowEnd}`,
        `${s.rejectionCount} row rejection(s); ${s.quarantinedItemKeys.length} item(s) isolated`,
        `source ${s.sourceId} · ${s.provenance}`,
        "writable=false — no create, update or delete path exists",
      ],
    };
  }

  if (read.status === "READ_FAILED") {
    return {
      mode: "READ_FAILED",
      syntheticFigures: true,
      badge: "READ FAILED",
      title: "The household connector is configured but the read did not complete.",
      detail: read.detail,
      facts: [
        "No live household state is shown.",
        "Everything below comes from the synthetic harness, not your household.",
      ],
    };
  }

  return {
    mode: "NOT_CONFIGURED",
    syntheticFigures: true,
    badge: "NOT CONFIGURED",
    title: "No household connector is configured, so no live data is being read.",
    detail: read.detail,
    facts: [
      read.missing.length
        ? `Missing configuration: ${read.missing.join(", ")}`
        : "Missing configuration: none reported",
      "Everything below comes from the synthetic harness, not your household.",
    ],
  };
}
