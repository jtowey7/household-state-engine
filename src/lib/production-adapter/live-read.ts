/**
 * Food OS — read-only LIVE household-state summary.
 *
 * Smallest safe bridge between the existing GET-only Airtable connector and an
 * operator surface. It reads HOUSEHOLD EVENTS through the existing read-only
 * port and returns counts/provenance only — never rows, never credentials.
 *
 * Boundary properties:
 * - no configuration => `NOT_CONFIGURED`; it never falls back to fixtures and
 *   never labels synthetic data as live;
 * - the connector is GET-only (`readOnlyFetch`) and the port has no write
 *   member, so no household record can be created, updated or deleted;
 * - a failed read is reported verbatim as `READ_FAILED`, not smoothed over.
 */

import { loadProductionState } from "./adapter";
import { createEvidenceAwareAirtableProductionPort } from "./evidence-aware-port";
import { type AirtableRowSource } from "./airtable-port";
import {
  createAirtableRestRowSource,
  describeAirtableConnectivity,
  readOnlyFetch,
  resolveAirtableConfig,
  type FetchLike,
} from "./airtable-rest-source";
import type { SourceScope } from "./types";

export interface LiveHouseholdSummary {
  eventCount: number;
  /** Item keys isolated by a non-fatal rejection; unrelated work continues. */
  quarantinedItemKeys: string[];
  rejectionCount: number;
  /** Deterministic hash of exactly what was loaded. */
  sourceId: string;
  provenance: string;
  windowStart: string;
  windowEnd: string;
  /** Always false: this path cannot write household state. */
  readonly writable: false;
}

export type LiveHouseholdRead =
  | { status: "NOT_CONFIGURED"; detail: string; missing: string[]; summary: null }
  | { status: "READ_FAILED"; detail: string; missing: []; summary: null }
  | { status: "LIVE"; detail: string; missing: []; summary: LiveHouseholdSummary };

export interface LiveHouseholdReadOptions {
  scope: Omit<SourceScope, "mode">;
  env?: Record<string, string | undefined>;
  /** Injected by tests; production uses global fetch. */
  fetchImpl?: FetchLike;
  /** Injected by tests that exercise the port without HTTP. */
  sourceOverride?: AirtableRowSource;
}

export async function readLiveHouseholdSummary(
  options: LiveHouseholdReadOptions,
): Promise<LiveHouseholdRead> {
  let source = options.sourceOverride;

  if (!source) {
    const resolution = resolveAirtableConfig(options.env);
    if (resolution.status === "NOT_CONFIGURED") {
      return {
        status: "NOT_CONFIGURED",
        detail: describeAirtableConnectivity(resolution),
        missing: resolution.missing,
        summary: null,
      };
    }
    const baseFetch =
      options.fetchImpl ??
      ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    source = createAirtableRestRowSource({
      config: resolution.config,
      fetchImpl: readOnlyFetch(baseFetch),
    });
  }

  const scope: SourceScope = { ...options.scope, mode: "PRODUCTION_READ_ONLY" };
  const port = createEvidenceAwareAirtableProductionPort({
    source,
    mode: "PRODUCTION_READ_ONLY",
    portId: `airtable-live:${source.baseLabel}`,
  });

  const loaded = await loadProductionState(port, scope);

  if (!loaded.ok) {
    const fatal = loaded.rejections.find((r) => r.fatal);
    return {
      status: "READ_FAILED",
      detail: fatal
        ? `Live read refused (${fatal.code}): ${fatal.detail}`
        : "Live read did not complete; nothing was written and nothing was ordered.",
      missing: [],
      summary: null,
    };
  }

  return {
    status: "LIVE",
    detail:
      "Live HOUSEHOLD EVENTS read completed read-only (GET only, no write path, no dispatch).",
    missing: [],
    summary: {
      eventCount: loaded.openingEvents.length,
      quarantinedItemKeys: loaded.quarantinedItemKeys,
      rejectionCount: loaded.rejections.length,
      sourceId: loaded.sourceId,
      provenance: source.provenance,
      windowStart: scope.windowStart,
      windowEnd: scope.windowEnd,
      writable: false,
    },
  };
}
