/**
 * Food OS — real Airtable HOUSEHOLD EVENTS connector (READ-ONLY, GET-only).
 *
 * This connector talks directly to the Airtable REST API from the trusted
 * server/runtime boundary. The browser never receives the Airtable token.
 * There is deliberately no Lovable connector dependency here.
 *
 * Safety properties enforced in this file:
 * - only HTTP GET is ever issued; a non-GET request is a thrown programming
 *   error, and the source exposes no create/update/delete member;
 * - only the exact HOUSEHOLD EVENTS field names are requested (`fields[]`);
 * - `Record class` filtering happens downstream in the State Engine so the
 *   exclusion remains provable in replay;
 * - non-OK responses surface the provider status and body; there is no fixture
 *   or static-inventory fallback;
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

export const AIRTABLE_API_URL = "https://api.airtable.com";

/** Environment keys this connector reads. Nothing else is consulted. */
export const AIRTABLE_ENV_KEYS = {
  apiKey: "AIRTABLE_API_KEY",
  baseId: "AIRTABLE_FOOD_OS_BASE_ID",
  eventsTable: "AIRTABLE_HOUSEHOLD_EVENTS_TABLE",
} as const;

export interface AirtableConnectorConfig {
  apiKey: string;
  baseId: string;
  eventsTable: string;
  apiUrl?: string;
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
    apiKey: read(AIRTABLE_ENV_KEYS.apiKey),
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
      apiKey: values.apiKey!,
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
    ? "Airtable connector configured — direct REST reads are GET-only and write paths do not exist."
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
  const base = `${config.apiUrl ?? AIRTABLE_API_URL}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(config.eventsTable)}`;
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
        Authorization: `Bearer ${config.apiKey}`,
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
      `airtable read-only GET ${config.baseId}/${config.eventsTable} via Airtable REST API`,
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
