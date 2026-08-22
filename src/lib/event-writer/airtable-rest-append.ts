import { hashOf } from "../state-engine/hash";
import type { FetchLike } from "../production-adapter/airtable-rest-source";
import type { AirtableAppendPort, CanonicalAppendRecord, PortAppendAck } from "./types";
import { AppendConflictError } from "./ports";

export const HOUSEHOLD_EVENTS_TABLE = "tbluDjPNJ3hxUpWxN";

const EVENT_FIELDS = [
  "Event ID",
  "Event type",
  "Occurred at",
  "Item",
  "Quantity delta",
  "Unit",
  "State after",
  "Supersedes event ID",
  "Record class",
] as const;

type AirtableRow = { id: string; fields: Record<string, unknown> };
type InFlightAppend = { payloadHash: string; promise: Promise<PortAppendAck> };

export interface AirtableRestAppendPortOptions {
  baseId: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  /** Existing ledger payload hashes from the same snapshot. */
  existing?: Map<string, string | null>;
}

function field(fields: Record<string, unknown>, name: (typeof EVENT_FIELDS)[number]): unknown {
  return fields[name];
}

function payloadHash(fields: Record<string, unknown>): string | null {
  const eventType = field(fields, "Event type");
  const item = field(fields, "Item");
  const occurredAt = field(fields, "Occurred at");
  const quantityDelta = field(fields, "Quantity delta");
  const unit = field(fields, "Unit");
  const stateAfterRaw = field(fields, "State after");
  const recordClass = field(fields, "Record class");
  if (typeof eventType !== "string" || typeof item !== "string" || typeof occurredAt !== "string" || typeof recordClass !== "string") return null;
  const stateAfter = typeof stateAfterRaw === "string" && stateAfterRaw.trim() ? Number(stateAfterRaw) : null;
  const supersedesRaw = field(fields, "Supersedes event ID");
  const supersedes = Array.isArray(supersedesRaw)
    ? supersedesRaw.filter((value): value is string => typeof value === "string").sort()
    : typeof supersedesRaw === "string" && supersedesRaw.trim()
      ? supersedesRaw.split(",").map((value) => value.trim()).filter(Boolean).sort()
      : [];
  return hashOf({
    eventType,
    item: item.trim(),
    occurredAt,
    quantityDelta: typeof quantityDelta === "number" ? quantityDelta : null,
    stateAfter: Number.isFinite(stateAfter) ? stateAfter : null,
    unit: typeof unit === "string" && unit.trim() ? unit.trim() : null,
    recordClass,
    supersedes,
  });
}

function rowFields(record: CanonicalAppendRecord): Record<string, unknown> {
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
    "Supersedes event ID": Array.isArray(row["Supersedes event ID"]) ? row["Supersedes event ID"].join(", ") : row["Supersedes event ID"],
    "Exception / reconciliation action": row["Exception / reconciliation action"],
    "Replay status": row["Replay status"],
    "Record class": row["Record class"],
  };
}

export function createAirtableRestAppendPort(options: AirtableRestAppendPortOptions): AirtableAppendPort {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const existing = options.existing ?? new Map<string, string | null>();
  const inFlight = new Map<string, InFlightAppend>();

  const recoverUncertainAppend = async (record: CanonicalAppendRecord): Promise<PortAppendAck | null> => {
    const formula = `{Event ID}='${record.eventId.replace(/'/g, "\\'")}'`;
    const params = new URLSearchParams({ filterByFormula: formula, maxRecords: "2" });
    for (const fieldName of EVENT_FIELDS) params.append("fields[]", fieldName);
    try {
      const response = await fetchImpl(
        `https://api.airtable.com/v0/${encodeURIComponent(options.baseId)}/${encodeURIComponent(HOUSEHOLD_EVENTS_TABLE)}?${params.toString()}`,
        { method: "GET", headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" } },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { records?: AirtableRow[] };
      const matches = (payload.records ?? []).filter((row) => field(row.fields, "Event ID") === record.eventId);
      if (matches.length === 0) return null;
      if (matches.length > 1) throw new AppendConflictError(record.eventId, "multiple-records", record.payloadHash);
      const match = matches[0];
      const priorHash = payloadHash(match.fields);
      if (priorHash !== record.payloadHash) {
        throw new AppendConflictError(record.eventId, priorHash ?? "unknown", record.payloadHash);
      }
      existing.set(record.eventId, priorHash);
      return { connectorRecordId: match.id, acknowledgedAt: new Date().toISOString(), duplicate: true };
    } catch (error) {
      if (error instanceof AppendConflictError) throw error;
      return null;
    }
  };

  const appendFresh = async (record: CanonicalAppendRecord): Promise<PortAppendAck> => {
    // Always preflight the immutable Event ID immediately before POST. The
    // workflow is serialised at the release boundary, so this closes the
    // sequential duplicate path even when callers did not preload `existing`.
    const prior = await recoverUncertainAppend(record);
    if (prior) return prior;

    try {
      const response = await fetchImpl(
        `https://api.airtable.com/v0/${encodeURIComponent(options.baseId)}/${encodeURIComponent(HOUSEHOLD_EVENTS_TABLE)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ records: [{ fields: rowFields(record) }] }),
        },
      );
      if (!response.ok) throw new Error(`Airtable append failed [${response.status}]: ${await response.text()}`);
      const payload = (await response.json()) as { records?: { id?: unknown }[] };
      const connectorRecordId = payload.records?.[0]?.id;
      if (typeof connectorRecordId !== "string") throw new Error("Airtable append returned no record ID; refusing to claim success.");
      existing.set(record.eventId, record.payloadHash);
      return { connectorRecordId, acknowledgedAt: new Date().toISOString() };
    } catch (error) {
      const recovered = await recoverUncertainAppend(record);
      if (recovered) return recovered;
      throw error;
    }
  };

  return {
    portId: `airtable:${options.baseId}`,
    provenance: "PRODUCTION",
    baseId: options.baseId,
    tableName: "HOUSEHOLD EVENTS",
    async append(record: CanonicalAppendRecord): Promise<PortAppendAck> {
      const prior = existing.get(record.eventId);
      if (prior !== undefined) {
        if (prior === record.payloadHash) return { connectorRecordId: `existing:${record.eventId}`, acknowledgedAt: new Date().toISOString(), duplicate: true };
        throw new AppendConflictError(record.eventId, prior ?? "unknown", record.payloadHash);
      }

      const pending = inFlight.get(record.eventId);
      if (pending) {
        if (pending.payloadHash !== record.payloadHash) throw new AppendConflictError(record.eventId, pending.payloadHash, record.payloadHash);
        const ack = await pending.promise;
        return { ...ack, duplicate: true };
      }

      const promise = appendFresh(record);
      inFlight.set(record.eventId, { payloadHash: record.payloadHash, promise });
      try {
        return await promise;
      } finally {
        inFlight.delete(record.eventId);
      }
    },
  };
}

export function buildExistingEventLedger(rows: AirtableRow[]): Map<string, string | null> {
  const ledger = new Map<string, string | null>();
  for (const row of rows) {
    const eventId = field(row.fields, "Event ID");
    if (typeof eventId === "string" && eventId.trim()) ledger.set(eventId, payloadHash(row.fields));
  }
  return ledger;
}
