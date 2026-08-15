import { hashOf } from "../src/lib/state-engine/hash";
import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
} from "../src/lib/state-engine/inventory-reconciliation";
import { buildInventoryBaseline } from "../src/lib/state-engine/inventory-baseline";
import { canonicaliseAppend } from "../src/lib/event-writer/canonical";
import { appendBaselineBatch, batchFingerprintFor } from "../src/lib/event-writer/baseline-batch";
import { createHouseholdEventWriter } from "../src/lib/event-writer/writer";
import { AppendConflictError, createAirtableAppendPort } from "../src/lib/event-writer/ports";
import type { CanonicalAppendRecord } from "../src/lib/event-writer/types";
import type { FetchLike } from "../src/lib/production-adapter/airtable-rest-source";
import type { InventoryBaselineRow } from "../src/lib/state-engine/inventory-baseline";

const INVENTORY_TABLE_ID = "tblN5ZnsivyfIQKnE";
const RECONCILIATIONS_TABLE_ID = "tbl42NyhXosHPiCpX";
const EVENTS_TABLE_ID = "tbluDjPNJ3hxUpWxN";
const INVENTORY_FIELDS = [
  "fld58iyqxlpG04WGN",
  "fldAtqN53EWTGsYBH",
  "fldNAS3ubie509gtt",
  "fld827WKdtfBVP5fT",
  "fldkI4brbFEppTgW3",
] as const;
const RECONCILIATION_FIELDS = [
  "fldzwJl3oMkaGKSLC",
  "flde1REBRL629ubxe",
  "fldjNfmYDaRNUkkWv",
  "fldwwFWQTl2K5dIdS",
] as const;
const EVENT_FIELDS = [
  "fld0eOLFhMirrp3sp",
  "fldofNnuJSzaZBgO9",
  "fldllmvZqSOV8wRVB",
  "flddW9gBfP3MeaLbT",
  "fldyzlpssmG8TykGG",
  "fld3t0OMEE5XmMg85",
  "fld01W4Pp3V3DQQQ3",
  "fldvzWQzid0uJTk8Z",
  "fldzu1QfNZwhGAeln",
] as const;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
  offset?: unknown;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required production baseline execution variable: ${key}`);
  return value;
}

function numberEnv(env: Record<string, string | undefined>, key: string): number {
  const value = Number(required(env, key));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

function fieldValue(fields: Record<string, unknown>, id: string, name: string): unknown {
  return fields[id] ?? fields[name];
}

function selectName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

async function listRows(
  fetchImpl: FetchLike,
  apiKey: string,
  baseId: string,
  tableId: string,
  fields: readonly string[],
): Promise<{ id: string; fields: Record<string, unknown> }[]> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    for (const field of fields) params.append("fields[]", field);
    if (offset) params.set("offset", offset);
    const response = await fetchImpl(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`Airtable read failed [${response.status}] for ${tableId}: ${await response.text()}`);
    const payload = (await response.json()) as AirtableListResponse;
    if (!Array.isArray(payload.records)) throw new Error(`Airtable read for ${tableId} returned no records array; refusing partial snapshot.`);
    for (const record of payload.records) {
      if (typeof record.id !== "string") throw new Error(`Airtable ${tableId} record is missing its record id.`);
      rows.push({ id: record.id, fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : {} });
    }
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return rows;
  }
  throw new Error(`Airtable read for ${tableId} exceeded ${MAX_PAGES} pages; refusing a partial snapshot.`);
}

function canonicalRecords(
  inventory: { id: string; fields: Record<string, unknown> }[],
  reconciliations: { id: string; fields: Record<string, unknown> }[],
  baselineTimestamp: string,
): CanonicalAppendRecord[] {
  const rows: InventoryBaselineRow[] = inventory.map((record) => ({
    recordId: record.id,
    item: typeof fieldValue(record.fields, "fld58iyqxlpG04WGN", "Item") === "string" ? fieldValue(record.fields, "fld58iyqxlpG04WGN", "Item") as string : "",
    quantity: typeof fieldValue(record.fields, "fldAtqN53EWTGsYBH", "Quantity") === "number" ? fieldValue(record.fields, "fldAtqN53EWTGsYBH", "Quantity") as number : fieldValue(record.fields, "fldAtqN53EWTGsYBH", "Quantity") == null ? null : undefined,
    unit: typeof fieldValue(record.fields, "fldNAS3ubie509gtt", "Unit") === "string" ? fieldValue(record.fields, "fldNAS3ubie509gtt", "Unit") as string : undefined,
    status: selectName(fieldValue(record.fields, "fld827WKdtfBVP5fT", "Status")),
    notes: typeof fieldValue(record.fields, "fldkI4brbFEppTgW3", "Notes") === "string" ? fieldValue(record.fields, "fldkI4brbFEppTgW3", "Notes") as string : undefined,
  }));
  const decisions: InventoryBaselineReconciliation[] = reconciliations.map((record) => ({
    recordId: typeof fieldValue(record.fields, "fldzwJl3oMkaGKSLC", "Inventory record ID") === "string" ? fieldValue(record.fields, "fldzwJl3oMkaGKSLC", "Inventory record ID") as string : "",
    disposition: selectName(fieldValue(record.fields, "flde1REBRL629ubxe", "Disposition")) as InventoryBaselineReconciliation["disposition"],
    reason: typeof fieldValue(record.fields, "fldjNfmYDaRNUkkWv", "Reason") === "string" ? fieldValue(record.fields, "fldjNfmYDaRNUkkWv", "Reason") as string : "",
    evidence: typeof fieldValue(record.fields, "fldwwFWQTl2K5dIdS", "Evidence") === "string" ? fieldValue(record.fields, "fldwwFWQTl2K5dIdS", "Evidence") as string : "",
  }));
  const reconciled = applyInventoryBaselineReconciliations(rows, baselineTimestamp, decisions);
  if (!isReconciledBaselineReady(reconciled)) throw new Error(`Production baseline refused: ${reconciled.unresolvedExceptions.length} unresolved exception(s).`);
  const records: CanonicalAppendRecord[] = [];
  for (const event of reconciled.events) {
    const quantity = event.payload.quantity;
    const unit = event.payload.unit;
    if (typeof quantity !== "number" || typeof unit !== "string" || !unit.trim()) throw new Error(`Production baseline event ${event.eventId} cannot be canonicalised without quantity and unit.`);
    const canonical = canonicaliseAppend({
      eventType: "Correction",
      item: event.itemKey,
      occurredAt: event.occurredAt,
      stateAfter: quantity,
      unit,
      source: "INVENTORY_SNAPSHOT",
      actor: "Food OS baseline initialisation",
      entityType: "Inventory item",
      evidence: event.payload.note ?? `baseline:${event.eventId}`,
      confidence: "High",
      recordClass: "Production",
      eventId: undefined,
    }, { now: () => baselineTimestamp });
    if (!canonical.ok) throw new Error(`Baseline event ${event.eventId} failed canonicalisation: ${canonical.rejection.detail}`);
    records.push(canonical.record);
  }
  return records;
}

function existingPayloadHash(fields: Record<string, unknown>): string | null {
  const eventType = fieldValue(fields, "fldofNnuJSzaZBgO9", "Event type");
  const item = fieldValue(fields, "flddW9gBfP3MeaLbT", "Item");
  const occurredAt = fieldValue(fields, "fldllmvZqSOV8wRVB", "Occurred at");
  const quantityDelta = fieldValue(fields, "fldyzlpssmG8TykGG", "Quantity delta");
  const unit = fieldValue(fields, "fld3t0OMEE5XmMg85", "Unit");
  const recordClass = fieldValue(fields, "fldzu1QfNZwhGAeln", "Record class");
  if (typeof eventType !== "string" || typeof item !== "string" || typeof occurredAt !== "string" || typeof recordClass !== "string") return null;
  const stateAfterRaw = fieldValue(fields, "fldxqIfgRcM4b673v", "State after");
  const supersedesRaw = fieldValue(fields, "fldvzWQzid0uJTk8Z", "Supersedes event ID");
  const stateAfter = typeof stateAfterRaw === "string" && stateAfterRaw.trim() ? Number(stateAfterRaw) : null;
  const supersedes = Array.isArray(supersedesRaw) ? supersedesRaw.filter((value): value is string => typeof value === "string").sort() : [];
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

async function appendTransport(
  fetchImpl: FetchLike,
  apiKey: string,
  baseId: string,
  existing: Map<string, string | null>,
  record: CanonicalAppendRecord,
) {
  const prior = existing.get(record.eventId);
  if (prior !== undefined) {
    if (prior === record.payloadHash) return { connectorRecordId: `existing:${record.eventId}`, acknowledgedAt: new Date().toISOString(), duplicate: true };
    throw new AppendConflictError(record.eventId, prior ?? "unknown", record.payloadHash);
  }
  const response = await fetchImpl(
    `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(EVENTS_TABLE_ID)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields: record.row }] }),
    },
  );
  if (!response.ok) throw new Error(`Airtable append failed [${response.status}]: ${await response.text()}`);
  const payload = (await response.json()) as { records?: { id?: unknown }[] };
  const connectorRecordId = payload.records?.[0]?.id;
  if (typeof connectorRecordId !== "string") throw new Error("Airtable append returned no record ID; refusing to claim success.");
  existing.set(record.eventId, record.payloadHash);
  return { connectorRecordId, acknowledgedAt: new Date().toISOString() };
}

export async function executeProductionBaseline(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<unknown> {
  if (env.FOODOS_BASELINE_EXECUTE !== "CONFIRM_ONE_TIME_BASELINE") {
    throw new Error("Production baseline is fail-closed. Set FOODOS_BASELINE_EXECUTE=CONFIRM_ONE_TIME_BASELINE only for the separately approved one-time operation.");
  }
  const apiKey = required(env, "AIRTABLE_API_KEY");
  const baseId = required(env, "AIRTABLE_BASE_ID");
  const expectedSnapshotId = required(env, "FOODOS_BASELINE_SNAPSHOT_ID");
  const expectedFingerprint = required(env, "FOODOS_BASELINE_SNAPSHOT_FINGERPRINT");
  const expectedEventCount = numberEnv(env, "FOODOS_BASELINE_EVENT_COUNT");
  const authorization = {
    authorizationId: required(env, "FOODOS_BASELINE_AUTHORIZATION_ID"),
    decision: "APPROVED" as const,
    approvedBy: required(env, "FOODOS_BASELINE_APPROVED_BY"),
    approvedAt: required(env, "FOODOS_BASELINE_APPROVED_AT"),
    evidenceSource: required(env, "FOODOS_BASELINE_EVIDENCE_SOURCE") as "EXPLICIT_USER_INPUT" | "STRONG_TRANSACTION_EVIDENCE",
    evidenceDetail: required(env, "FOODOS_BASELINE_EVIDENCE_DETAIL"),
    actionPolicyReference: required(env, "FOODOS_BASELINE_ACTION_POLICY_REFERENCE"),
    batchFingerprint: expectedFingerprint,
    snapshotId: expectedSnapshotId,
    eventCount: expectedEventCount,
  };
  if (!["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"].includes(authorization.evidenceSource)) throw new Error("Invalid baseline evidence source.");

  const inventory = await listRows(fetchImpl, apiKey, baseId, INVENTORY_TABLE_ID, INVENTORY_FIELDS);
  const reconciliations = await listRows(fetchImpl, apiKey, baseId, RECONCILIATIONS_TABLE_ID, RECONCILIATION_FIELDS);
  const rawSnapshot = {
    inventory: inventory.map((record) => ({ id: record.id, fields: record.fields })).sort((a, b) => a.id.localeCompare(b.id)),
    reconciliations: reconciliations.map((record) => ({ id: record.id, fields: record.fields })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const snapshotFingerprint = hashOf(rawSnapshot);
  const baselineTimestamp = required(env, "FOODOS_BASELINE_TIMESTAMP");
  const records = canonicalRecords(inventory, reconciliations, baselineTimestamp);
  const baselineId = buildInventoryBaseline(
    inventory.map((record) => ({
      recordId: record.id,
      item: typeof fieldValue(record.fields, "fld58iyqxlpG04WGN", "Item") === "string" ? fieldValue(record.fields, "fld58iyqxlpG04WGN", "Item") as string : "",
      quantity: typeof fieldValue(record.fields, "fldAtqN53EWTGsYBH", "Quantity") === "number" ? fieldValue(record.fields, "fldAtqN53EWTGsYBH", "Quantity") as number : null,
      unit: selectName(fieldValue(record.fields, "fldNAS3ubie509gtt", "Unit")),
      status: selectName(fieldValue(record.fields, "fld827WKdtfBVP5fT", "Status")),
      notes: typeof fieldValue(record.fields, "fldkI4brbFEppTgW3", "Notes") === "string" ? fieldValue(record.fields, "fldkI4brbFEppTgW3", "Notes") as string : undefined,
    })),
    baselineTimestamp,
  ).baselineId;
  if (snapshotFingerprint !== expectedFingerprint) throw new Error("Production baseline refused: live snapshot fingerprint differs from approved authority.");
  if (baselineId !== expectedSnapshotId) throw new Error("Production baseline refused: live baseline ID differs from approved snapshot authority.");
  if (records.length !== expectedEventCount) throw new Error(`Production baseline refused: live event count ${records.length} differs from approved ${expectedEventCount}.`);
  const batchFingerprint = batchFingerprintFor(records);
  if (batchFingerprint !== expectedFingerprint) throw new Error("Production baseline refused: canonical batch fingerprint differs from approved authority.");

  const existingRows = await listRows(fetchImpl, apiKey, baseId, EVENTS_TABLE_ID, EVENT_FIELDS);
  const existing = new Map<string, string | null>();
  for (const row of existingRows) {
    const eventId = fieldValue(row.fields, "fld0eOLFhMirrp3sp", "Event ID");
    if (typeof eventId === "string" && eventId) existing.set(eventId, existingPayloadHash(row.fields));
  }

  const portResult = createAirtableAppendPort({
    baseId,
    credential: apiKey,
    transport: (record) => appendTransport(fetchImpl, apiKey, baseId, existing, record),
  });
  if (!portResult.ok) throw new Error(portResult.detail);
  const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: portResult.port });
  const receipts = await appendBaselineBatch(writer, records, authorization);
  const rejected = receipts.filter((receipt) => receipt.outcome === "REJECTED");
  if (rejected.length) throw new Error(`Production baseline stopped with ${rejected.length} rejected append(s). First rejection: ${rejected[0]?.rejection?.detail ?? "unknown"}`);
  return { ok: true, snapshotFingerprint, baselineId: expectedSnapshotId, eventCount: records.length, appended: receipts.filter((r) => r.written).length, duplicateNoop: receipts.filter((r) => r.outcome === "DUPLICATE_NOOP").length };
}

if (import.meta.main) {
  executeProductionBaseline(process.env)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
