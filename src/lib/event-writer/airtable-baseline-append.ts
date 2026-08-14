/**
 * One-time Production HOUSEHOLD EVENTS baseline append transport for Airtable.
 *
 * This is deliberately narrower than a general household-event connector:
 * only deterministic BASELINE:* Event IDs are accepted. Routine consumption,
 * delivery or correction events cannot reach this transport.
 *
 * The transport is append-only. It performs a GET-by-Event-ID preflight so an
 * identical retry is acknowledged as a duplicate and a different payload for
 * an existing Event ID is rejected before POST. There is no update/delete/
 * upsert operation.
 */

import { canonicalize } from "../state-engine/hash";
import type { CanonicalAppendRecord, PortAppendAck } from "./types";

export interface AirtableBaselineAppendConfig {
  apiKey: string;
  baseId: string;
  tableName?: "HOUSEHOLD EVENTS";
  apiUrl?: string;
  fetchImpl: BaselineAppendFetch;
}

export type BaselineAppendFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

interface AirtableRecord {
  id?: unknown;
  fields?: unknown;
}

interface AirtableListResponse {
  records?: AirtableRecord[];
  offset?: unknown;
}

const EVENT_ID_FIELD = "Event ID";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function endpoint(config: AirtableBaselineAppendConfig): string {
  return `${config.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(config.tableName ?? "HOUSEHOLD EVENTS")}`;
}

function headers(config: AirtableBaselineAppendConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function airtableFields(record: CanonicalAppendRecord): Record<string, unknown> {
  const row = record.row;
  return {
    "Event ID": record.eventId,
    "Event type": row["Event type"],
    "Occurred at": row["Occurred at"],
    "Recorded at": row["Recorded at"],
    Source: row.Source,
    Actor: row.Actor,
    "Entity type": row["Entity type"],
    "Entity reference": row["Entity reference"],
    Item: row.Item,
    "Quantity delta": row["Quantity delta"],
    Unit: row.Unit,
    Evidence: row.Evidence,
    "State before": row["State before"],
    "State after": row["State after"],
    Confidence: row.Confidence,
    "Supersedes event ID": row["Supersedes event ID"].join(","),
    "Exception / reconciliation action": row["Exception / reconciliation action"],
    "Replay status": row["Replay status"],
    "Record class": row["Record class"],
  };
}

function normalizedFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      entry === undefined || entry === null ? null : entry,
    ]),
  );
}

function sameFields(existing: unknown, expected: Record<string, unknown>): boolean {
  return canonicalize(normalizedFields(existing)) === canonicalize(normalizedFields(expected));
}

async function getByEventId(
  config: AirtableBaselineAppendConfig,
  eventId: string,
): Promise<AirtableRecord | null> {
  let offset: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("pageSize", String(PAGE_SIZE));
    params.set("filterByFormula", `{${EVENT_ID_FIELD}}=${JSON.stringify(eventId)}`);
    const url = `${endpoint(config)}?${params.toString()}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const response = await config.fetchImpl(url, { method: "GET", headers: headers(config) });
    if (!response.ok) {
      throw new Error(`Airtable baseline preflight failed [${response.status}]: ${await response.text()}`);
    }
    const payload = (await response.json()) as AirtableListResponse;
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error("Airtable baseline preflight returned no records array; refusing to guess.");
    }
    const found = payload.records.find((candidate) => {
      const fields = normalizedFields(candidate.fields);
      return fields[EVENT_ID_FIELD] === eventId;
    });
    if (found) return found;
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return null;
  }
  throw new Error(`Airtable baseline preflight exceeded ${MAX_PAGES} pages; refusing a partial read.`);
}

/**
 * Creates the narrowly scoped baseline transport. The returned function is
 * suitable for the existing createAirtableAppendPort() transport slot.
 */
export function createAirtableBaselineAppendTransport(
  config: AirtableBaselineAppendConfig,
): (record: CanonicalAppendRecord) => Promise<PortAppendAck> {
  if (!config.apiKey.trim()) throw new Error("Airtable baseline append requires an API key.");
  if (!config.baseId.trim()) throw new Error("Airtable baseline append requires a base ID.");

  return async (record) => {
    const eventId = record.eventId.trim();
    if (!eventId.startsWith("BASELINE:")) {
      throw new Error("Baseline append transport refuses non-baseline Event IDs.");
    }

    const expectedFields = airtableFields(record);
    const existing = await getByEventId(config, eventId);
    if (existing) {
      if (sameFields(existing.fields, expectedFields)) {
        return {
          connectorRecordId: typeof existing.id === "string" ? existing.id : `airtable:${eventId}`,
          acknowledgedAt: new Date().toISOString(),
          duplicate: true,
        };
      }
      throw new Error(`Airtable baseline Event ID ${eventId} already exists with a different payload; refusing mutation.`);
    }

    const response = await config.fetchImpl(endpoint(config), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ records: [{ fields: expectedFields }] }),
    });
    if (!response.ok) {
      throw new Error(`Airtable baseline append failed [${response.status}]: ${await response.text()}`);
    }
    const payload = (await response.json()) as { records?: AirtableRecord[] };
    const created = payload.records?.[0];
    if (!created || typeof created.id !== "string") {
      throw new Error("Airtable baseline append returned no connector record ID; refusing to claim success.");
    }

    return {
      connectorRecordId: created.id,
      acknowledgedAt: new Date().toISOString(),
    };
  };
}
