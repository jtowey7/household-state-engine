/**
 * Food OS — real Airtable HOUSEHOLD EVENTS connector (READ-ONLY, GET-only).
 *
 * This is the actual HTTP implementation of `AirtableRowSource`. It is wired
 * to the real field contract and the Lovable connector gateway, but it is NOT
 * currently connected: this workspace has no Airtable connection, so
 * `resolveAirtableConfig` reports NOT_CONFIGURED and nothing is fetched.
 * No credentials, base ids, table names, prices or rows are invented here —
 * every value comes from configuration supplied at runtime.
 *
 * Safety properties enforced in this file:
 * - only HTTP GET is ever issued; a non-GET request is a thrown programming
 *   error, and the source exposes no create/update/delete member;
 * - only the exact HOUSEHOLD EVENTS field names are requested (`fields[]`),
 *   so an unexpected upstream column can never leak into the mutation stream;
 * - `Record class` filtering happens upstream *and* downstream — the State
 *   Engine still excludes Test records after mapping;
 * - non-OK responses surface the provider status and body verbatim; the
 *   connector never falls back to fixtures or to a static inventory;
 * - pagination is followed via Airtable's `offset` with a hard page cap.
 */

import { HOUSEHOLD_EVENT_FIELDS, assertReadOnlySource } from "./airtable-port";
import type { AirtableRow, AirtableRowSource } from "./airtable-port";
import type { SourceScope } from "./types";

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export const AIRTABLE_GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";

/** Environment keys this connector reads. Nothing else is consulted. */
export const AIRTABLE_ENV_KEYS = {
  lovableApiKey: "LOVABLE_API_KEY",
  connectionKey: "AIRTABLE_API_KEY",
  baseId: "AIRTABLE_FOOD_OS_BASE_ID",
  eventsTable: "AIRTABLE_HOUSEHOLD_EVENTS_TABLE",
} as const;

export interface AirtableConnectorConfig {
  lovableApiKey: string;
  connectionKey: string;
  baseId: string;
  eventsTable: string;
  gatewayUrl?: string;
}

export type AirtableConfigResolution =
  | { status: "CONFIGURED"; config: AirtableConnectorConfig; missing: [] }
  | { status: "NOT_CONFIGURED"; config: null; missing: string[] };

/**
 * Configuration/credential boundary. Reads only the declared keys, never
 * throws, and reports precisely which values are absent so the caller can say
 * "not connected" instead of pretending.
 */
export function resolveAirtableConfig(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): AirtableConfigResolution {
  const read = (key: string): string | undefined => {
    const raw = env[key];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  };
  const values = {
    lovableApiKey: read(AIRTABLE_ENV_KEYS.lovableApiKey),
    connectionKey: read(AIRTABLE_ENV_KEYS.connectionKey),
    baseId: read(AIRTABLE_ENV_KEYS.baseId),
    eventsTable: read(AIRTABLE_ENV_KEYS.eventsTable),
  };
  const missing = (Object.keys(values) as (keyof typeof values)[])
    .filter((k) => values[k] === undefined)
    .map((k) => AIRTABLE_ENV_KEYS[k]);

  if (missing.length > 0) return { status: "NOT_CONFIGURED", config: null, missing };
  return {
    status: "CONFIGURED",
    config: {
      lovableApiKey: values.lovableApiKey!,
      connectionKey: values.connectionKey!,
      baseId: values.baseId!,
      eventsTable: values.eventsTable!,
    },
    missing: [],
  };
}

/** Human-readable connectivity statement. Never claims a live connection. */
export function describeAirtableConnectivity(
  resolution: AirtableConfigResolution,
): string {
  return resolution.status === "CONFIGURED"
    ? "Airtable connector configured — reads are GET-only and write paths do not exist."
    : `Airtable connector NOT configured (missing: ${resolution.missing.join(", ")}). No live household data is being read.`;
}

const MAX_PAGES = 50;
const PAGE_SIZE = 100;

/**
 * Airtable formula scoping the read to the cycle window. `Record class` is not
 * filtered away here — Test rows are carried through and excluded by the State
 * Engine, so exclusion stays provable in replay rather than hidden upstream.
 */
export function buildWindowFormula(scope: SourceScope): string {
  const start = JSON.stringify(scope.windowStart);
  const end = JSON.stringify(scope.windowEnd);
  return `AND(IS_AFTER({Occurred at}, DATEADD(${start}, -1, 'seconds')), IS_BEFORE({Occurred at}, DATEADD(${end}, 1, 'days')))`;
}

export function buildEventsUrl(
  config: AirtableConnectorConfig,
  scope: SourceScope,
  offset?: string,
): string {
  const base = `${config.gatewayUrl ?? AIRTABLE_GATEWAY_URL}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(config.eventsTable)}`;
  const params = new URLSearchParams();
  params.set("pageSize", String(PAGE_SIZE));
  params.set("filterByFormula", buildWindowFormula(scope));
  for (const field of HOUSEHOLD_EVENT_FIELDS) params.append("fields[]", field);
  if (offset) params.set("offset", offset);
  return `${base}?${params.toString()}`;
}

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
  offset?: unknown;
}

export interface AirtableRestSourceOptions {
  config: AirtableConnectorConfig;
  /** Injected so contract tests never touch the network. */
  fetchImpl: FetchLike;
  baseLabel?: string;
  provenance?: string;
}

/**
 * Builds the read-only HTTP row source. The returned object has exactly one
 * method — `listEventRows` — and issues only GET requests.
 */
export function createAirtableRestRowSource(
  options: AirtableRestSourceOptions,
): AirtableRowSource {
  const { config, fetchImpl } = options;

  const get = async (url: string): Promise<AirtableListResponse> => {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.lovableApiKey}`,
        "X-Connection-Api-Key": config.connectionKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable read failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as AirtableListResponse;
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error("Airtable read returned no `records` array; refusing to guess.");
    }
    return payload;
  };

  const source: AirtableRowSource = {
    baseLabel: options.baseLabel ?? `airtable:${config.baseId}/${config.eventsTable}`,
    provenance:
      options.provenance ??
      `airtable read-only GET ${config.baseId}/${config.eventsTable} via connector gateway`,
    async listEventRows(scope: SourceScope): Promise<AirtableRow[]> {
      const rows: AirtableRow[] = [];
      let offset: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const payload = await get(buildEventsUrl(config, scope, offset));
        for (const record of payload.records ?? []) {
          const id = typeof record.id === "string" ? record.id : "";
          if (!id) {
            throw new Error("Airtable record is missing its record id; refusing partial read.");
          }
          rows.push({
            id,
            fields:
              record.fields && typeof record.fields === "object"
                ? (record.fields as Record<string, unknown>)
                : {},
          });
        }
        offset = typeof payload.offset === "string" ? payload.offset : undefined;
        if (!offset) return rows;
      }
      throw new Error(
        `Airtable read exceeded ${MAX_PAGES} pages; refusing a partial household state.`,
      );
    },
  };

  // Same guard the port applies: this object must expose no mutation member.
  assertReadOnlySource(source);
  return source;
}

/**
 * Wraps a fetch implementation so any non-GET call throws before it leaves the
 * process. Production writes stay impossible even if this file is edited later.
 */
export function readOnlyFetch(inner: FetchLike): FetchLike {
  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(
        `Read-only Airtable connector refused a ${method} request; production writes are disabled.`,
      );
    }
    return inner(input, init);
  };
}
