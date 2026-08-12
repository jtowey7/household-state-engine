/**
 * Food OS — in-memory Airtable port for the scheduler control plane.
 *
 * BOUNDARY: this is a *stateful fake of the Airtable REST surface*, not a
 * connector. It exists so the real `createAirtableControlPlaneStore` code path
 * (URL shapes, filterByFormula, POST bodies, status handling) can be exercised
 * end-to-end with no credentials and no network. Nothing here ever touches
 * production household state; only the two control-plane tables exist.
 *
 * Behaviour deliberately mirrors the subset of Airtable the adapter uses:
 * - GET  /v0/{base}/{table}?filterByFormula={Field} = 'value'  → matching rows
 * - POST /v0/{base}/{table}  { records: [{ fields }] }         → append rows
 * Anything else is rejected loudly rather than silently faked.
 */

import type { ControlPlaneFetch } from "./airtable-control-plane";
import { CONTROL_PLANE_WRITABLE_TABLES } from "./airtable-control-plane";

export interface MemoryAirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface MemoryAirtableCall {
  method: string;
  table: string;
  url: string;
  body?: string;
}

export interface MemoryAirtableFault {
  status: number;
  body: string;
}

export interface MemoryAirtablePortOptions {
  /** Seed rows keyed by table name. */
  seed?: Record<string, Record<string, unknown>[]>;
  failReadsWith?: MemoryAirtableFault;
  failWritesWith?: MemoryAirtableFault;
  /** Returns a payload with no `records` array, to prove the adapter refuses to guess. */
  malformedReads?: boolean;
}

export interface MemoryAirtablePort {
  fetchImpl: ControlPlaneFetch;
  /** Durable rows, per table. Assertable proof of what was (not) written. */
  rows(table: string): MemoryAirtableRecord[];
  calls: MemoryAirtableCall[];
  writes(): MemoryAirtableCall[];
}

const FORMULA = /^\{([^}]+)\}\s*=\s*'((?:\\.|[^'\\])*)'$/;

function unescapeFormulaValue(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function decodeTable(url: string): string {
  const path = url.split("?")[0] ?? "";
  const last = path.split("/").pop() ?? "";
  return decodeURIComponent(last);
}

function response(status: number, payload: unknown, text = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => payload,
  };
}

export function createInMemoryAirtablePort(
  options: MemoryAirtablePortOptions = {},
): MemoryAirtablePort {
  const tables = new Map<string, MemoryAirtableRecord[]>();
  for (const table of CONTROL_PLANE_WRITABLE_TABLES) tables.set(table, []);
  for (const [table, records] of Object.entries(options.seed ?? {})) {
    tables.set(
      table,
      records.map((fields, i) => ({ id: `recseed${i}`, fields })),
    );
  }
  const calls: MemoryAirtableCall[] = [];
  let sequence = 0;

  const fetchImpl: ControlPlaneFetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const table = decodeTable(url);
    calls.push({ method, table, url, ...(init?.body ? { body: init.body } : {}) });

    if (method === "GET") {
      if (options.failReadsWith) {
        return response(options.failReadsWith.status, {}, options.failReadsWith.body);
      }
      if (options.malformedReads) return response(200, { unexpected: true });
      const query = url.includes("?") ? new URLSearchParams(url.split("?")[1]) : null;
      const formula = query?.get("filterByFormula") ?? "";
      const rows = tables.get(table) ?? [];
      const match = FORMULA.exec(formula);
      const records = match
        ? rows.filter((r) => r.fields[match[1]!] === unescapeFormulaValue(match[2]!))
        : rows;
      return response(200, { records });
    }

    if (method !== "POST") {
      return response(405, {}, `In-memory Airtable port does not implement ${method}.`);
    }
    if (options.failWritesWith) {
      return response(options.failWritesWith.status, {}, options.failWritesWith.body);
    }
    // Defence in depth: the adapter guards write scope, and so does the fake.
    if (!CONTROL_PLANE_WRITABLE_TABLES.some((t) => t === table.toUpperCase())) {
      return response(403, {}, `Refused write to non-control-plane table "${table}".`);
    }
    let parsed: { records?: { fields?: Record<string, unknown> }[] };
    try {
      parsed = JSON.parse(init?.body ?? "") as typeof parsed;
    } catch {
      return response(422, {}, "Malformed request body.");
    }
    const created: MemoryAirtableRecord[] = [];
    const existing = tables.get(table) ?? [];
    for (const record of parsed.records ?? []) {
      const row = { id: `rec${++sequence}`, fields: { ...(record.fields ?? {}) } };
      existing.push(row);
      created.push(row);
    }
    tables.set(table, existing);
    return response(200, { records: created });
  };

  return {
    fetchImpl,
    calls,
    rows: (table) => [...(tables.get(table) ?? [])],
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}
