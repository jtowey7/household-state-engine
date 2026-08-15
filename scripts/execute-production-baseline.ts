import { hashOf } from "../src/lib/state-engine/hash";
import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
} from "../src/lib/state-engine/inventory-reconciliation";
import { buildInventoryBaseline, type InventoryBaselineRow } from "../src/lib/state-engine/inventory-baseline";
import { canonicaliseAppend } from "../src/lib/event-writer/canonical";
import { appendBaselineBatch, batchFingerprintFor } from "../src/lib/event-writer/baseline-batch";
import { AppendConflictError, createAirtableAppendPort } from "../src/lib/event-writer/ports";
import { createHouseholdEventWriter } from "../src/lib/event-writer/writer";
import type { CanonicalAppendRecord } from "../src/lib/event-writer/types";
import type { FetchLike } from "../src/lib/production-adapter/airtable-rest-source";

const INVENTORY = "tblN5ZnsivyfIQKnE";
const RECONCILIATIONS = "tbl42NyhXosHPiCpX";
const EVENTS = "tbluDjPNJ3hxUpWxN";
const INVENTORY_FIELDS = ["fld58iyqxlpG04WGN", "fldAtqN53EWTGsYBH", "fldNAS3ubie509gtt", "fld827WKdtfBVP5fT", "fldkI4brbFEppTgW3"];
const RECON_FIELDS = ["fldzwJl3oMkaGKSLC", "flde1REBRL629ubxe", "fldjNfmYDaRNUkkWv", "fldwwFWQTl2K5dIdS"];
const EVENT_FIELDS = ["fld0eOLFhMirrp3sp", "fldofNnuJSzaZBgO9", "fldllmvZqSOV8wRVB", "flddW9gBfP3MeaLbT", "fldyzlpssmG8TykGG", "fld3t0OMEE5XmMg85", "fldxqIfgRcM4b673v", "fldvzWQzid0uJTk8Z", "fldzu1QfNZwhGAeln"];
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

type Row = { id: string; fields: Record<string, unknown> };

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required production baseline execution variable: ${key}`);
  return value;
}

function positiveInt(env: Record<string, string | undefined>, key: string): number {
  const value = Number(required(env, key));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

function value(fields: Record<string, unknown>, id: string, name: string): unknown {
  return fields[id] ?? fields[name];
}

function selectName(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "name" in input) {
    const name = (input as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

async function listRows(fetchImpl: FetchLike, apiKey: string, baseId: string, tableId: string, fields: string[]): Promise<Row[]> {
  const rows: Row[] = [];
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
    const payload = (await response.json()) as { records?: { id?: unknown; fields?: unknown }[]; offset?: unknown };
    if (!Array.isArray(payload.records)) throw new Error(`Airtable read for ${tableId} returned no records array; refusing partial snapshot.`);
    for (const record of payload.records) {
      if (typeof record.id !== "string") throw new Error(`Airtable ${tableId} record is missing its record ID.`);
      rows.push({ id: record.id, fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : {} });
    }
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return rows;
  }
  throw new Error(`Airtable read for ${tableId} exceeded ${MAX_PAGES} pages; refusing partial snapshot.`);
}

function inventoryRows(rows: Row[]): InventoryBaselineRow[] {
  return rows.map((row) => ({
    recordId: row.id,
    item: typeof value(row.fields, "fld58iyqxlpG04WGN", "Item") === "string" ? value(row.fields, "fld58iyqxlpG04WGN", "Item") as string : "",
    quantity: typeof value(row.fields, "fldAtqN53EWTGsYBH", "Quantity") === "number" ? value(row.fields, "fldAtqN53EWTGsYBH", "Quantity") as number : value(row.fields, "fldAtqN53EWTGsYBH", "Quantity") == null ? null : undefined,
    unit: selectName(value(row.fields, "fldNAS3ubie509gtt", "Unit")),
    status: selectName(value(row.fields, "fld827WKdtfBVP5fT", "Status")),
    notes: typeof value(row.fields, "fldkI4brbFEppTgW3", "Notes") === "string" ? value(row.fields, "fldkI4brbFEppTgW3", "Notes") as string : undefined,
  }));
}

function decisions(rows: Row[]): InventoryBaselineReconciliation[] {
  return rows.map((row) => ({
    recordId: typeof value(row.fields, "fldzwJl3oMkaGKSLC", "Inventory record ID") === "string" ? value(row.fields, "fldzwJl3oMkaGKSLC", "Inventory record ID") as string : "",
    disposition: selectName(value(row.fields, "flde1REBRL629ubxe", "Disposition")) as InventoryBaselineReconciliation["disposition"],
    reason: typeof value(row.fields, "fldjNfmYDaRNUkkWv", "Reason") === "string" ? value(row.fields, "fldjNfmYDaRNUkkWv", "Reason") as string : "",
    evidence: typeof value(row.fields, "fldwwFWQTl2K5dIdS", "Evidence") === "string" ? value(row.fields, "fldwwFWQTl2K5dIdS", "Evidence") as string : "",
  }));
}

function canonicalRecords(rows: InventoryBaselineRow[], reconciliationRows: Row[], timestamp: string): { records: CanonicalAppendRecord[]; baselineId: string } {
  const reconciled = applyInventoryBaselineReconciliations(rows, timestamp, decisions(reconciliationRows));
  if (!isReconciledBaselineReady(reconciled)) throw new Error(`Production baseline refused: ${reconciled.unresolvedExceptions.length} unresolved exception(s).`);
  const records: CanonicalAppendRecord[] = [];
  for (const event of reconciled.events) {
    const quantity = event.payload.quantity;
    const unit = event.payload.unit;
    if (typeof quantity !== "number" || typeof unit !== "string" || !unit.trim()) throw new Error(`Baseline event ${event.eventId} lacks a canonical quantity/unit.`);
    const result = canonicaliseAppend({
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
    }, { now: () => timestamp });
    if (!result.ok) throw new Error(`Baseline event ${event.eventId} failed canonicalisation: ${result.rejection.detail}`);
    records.push(result.record);
  }
  return { records, baselineId: reconciled.baselineId };
}

function existingPayloadHash(fields: Record<string, unknown>): string | null {
  const eventType = value(fields, "fldofNnuJSzaZBgO9", "Event type");
  const item = value(fields, "flddW9gBf3MeaLbT", "Item");
  const occurredAt = value(fields, "fldllmvZqSOV8wRVB", "Occurred at");
  const quantityDelta = value(fields, "fldyzlpssmG8TykGG", "Quantity delta");
  const unit = value(fields, "fld3t0OMEE5XmMg85", "Unit");
  const recordClass = value(fields, "fldzu1QfNZwhGAeln", "Record class");
  if (typeof eventType !== "string" || typeof item !== "string" || typeof occurredAt !== "string" || typeof recordClass !== "string") return null;
  const rawStateAfter = value(fields, "fldxqIfgRcM4b673v", "State after");
  const stateAfter = typeof rawStateAfter === "string" && rawStateAfter.trim() ? Number(rawStateAfter) : null;
  const supersedes = Array.isArray(value(fields, "fldvzWQzid0uJTk8Z", "Supersedes event ID"))
    ? (value(fields, "fldvzWQzid0uJTk8Z", "Supersedes event ID") as unknown[]).filter((x): x is string => typeof x === "string").sort()
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

function airtableBaselineFields(record: CanonicalAppendRecord): Record<string, unknown> {
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

async function appendOne(fetchImpl: FetchLike, apiKey: string, baseId: string, existing: Map<string, string | null>, record: CanonicalAppendRecord) {
  const prior = existing.get(record.eventId);
  if (prior !== undefined) {
    if (prior === record.payloadHash) return { connectorRecordId: `existing:${record.eventId}`, acknowledgedAt: new Date().toISOString(), duplicate: true };
    throw new AppendConflictError(record.eventId, prior ?? "unknown", record.payloadHash);
  }
  const response = await fetchImpl(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(EVENTS)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: airtableBaselineFields(record) }] }),
  });
  if (!response.ok) throw new Error(`Airtable append failed [${response.status}]: ${await response.text()}`);
  const payload = (await response.json()) as { records?: { id?: unknown }[] };
  const connectorRecordId = payload.records?.[0]?.id;
  if (typeof connectorRecordId !== "string") throw new Error("Airtable append returned no record ID; refusing to claim success.");
  existing.set(record.eventId, record.payloadHash);
  return { connectorRecordId, acknowledgedAt: new Date().toISOString() };
}

export async function executeProductionBaseline(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch as FetchLike): Promise<unknown> {
  if (env.FOODOS_BASELINE_EXECUTE !== "CONFIRM_ONE_TIME_BASELINE") throw new Error("Production baseline is fail-closed; explicit one-time confirmation is required.");
  const apiKey = required(env, "AIRTABLE_API_KEY");
  const baseId = required(env, "AIRTABLE_BASE_ID");
  const timestamp = required(env, "FOODOS_BASELINE_TIMESTAMP");
  const expectedSnapshotFingerprint = required(env, "FOODOS_BASELINE_SNAPSHOT_FINGERPRINT");
  const expectedBatchFingerprint = required(env, "FOODOS_BASELINE_BATCH_FINGERPRINT");
  const expectedSnapshotId = required(env, "FOODOS_BASELINE_SNAPSHOT_ID");
  const expectedEventCount = positiveInt(env, "FOODOS_BASELINE_EVENT_COUNT");
  const evidenceSource = required(env, "FOODOS_BASELINE_EVIDENCE_SOURCE") as "EXPLICIT_USER_INPUT" | "STRONG_TRANSACTION_EVIDENCE";
  if (!["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"].includes(evidenceSource)) throw new Error("Invalid production baseline evidence source.");

  const inventory = await listRows(fetchImpl, apiKey, baseId, INVENTORY, INVENTORY_FIELDS);
  const reconciliations = await listRows(fetchImpl, apiKey, baseId, RECONCILIATIONS, RECON_FIELDS);
  const snapshotFingerprint = hashOf({
    inventory: inventory.map((r) => ({ id: r.id, fields: r.fields })).sort((a, b) => a.id.localeCompare(b.id)),
    reconciliations: reconciliations.map((r) => ({ id: r.id, fields: r.fields })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  if (snapshotFingerprint !== expectedSnapshotFingerprint) throw new Error("Production baseline refused: live snapshot fingerprint differs from approved authority.");

  const rows = inventoryRows(inventory);
  const rawBaseline = buildInventoryBaseline(rows, timestamp);
  const { records, baselineId } = canonicalRecords(rows, reconciliations, timestamp);
  if (baselineId !== expectedSnapshotId) throw new Error("Production baseline refused: live reconciled baseline ID differs from approved authority.");
  if (records.length !== expectedEventCount) throw new Error(`Production baseline refused: live event count ${records.length} differs from approved ${expectedEventCount}.`);
  if (rawBaseline.sourceRecordIds.length !== inventory.length) throw new Error("Production baseline refused: source coverage changed during execution.");
  if (batchFingerprintFor(records) !== expectedBatchFingerprint) throw new Error("Production baseline refused: canonical batch fingerprint differs from approved authority.");

  const existingRows = await listRows(fetchImpl, apiKey, baseId, EVENTS, EVENT_FIELDS);
  const existing = new Map<string, string | null>();
  for (const row of existingRows) {
    const eventId = value(row.fields, "fld0eOLFhMirrp3sp", "Event ID");
    if (typeof eventId === "string" && eventId) existing.set(eventId, existingPayloadHash(row.fields));
  }

  const authorization = {
    authorizationId: required(env, "FOODOS_BASELINE_AUTHORIZATION_ID"),
    decision: "APPROVED" as const,
    approvedBy: required(env, "FOODOS_BASELINE_APPROVED_BY"),
    approvedAt: required(env, "FOODOS_BASELINE_APPROVED_AT"),
    evidenceSource,
    evidenceDetail: required(env, "FOODOS_BASELINE_EVIDENCE_DETAIL"),
    actionPolicyReference: required(env, "FOODOS_BASELINE_ACTION_POLICY_REFERENCE"),
    batchFingerprint: expectedBatchFingerprint,
    snapshotId: expectedSnapshotId,
    eventCount: expectedEventCount,
  };

  const portResult = createAirtableAppendPort({
    baseId,
    credential: apiKey,
    transport: (record) => appendOne(fetchImpl, apiKey, baseId, existing, record),
  });
  if (!portResult.ok) throw new Error(portResult.detail);
  const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port: portResult.port });
  const receipts = await appendBaselineBatch(writer, records, authorization);
  const rejected = receipts.filter((r) => r.outcome === "REJECTED");
  if (rejected.length) throw new Error(`Production baseline stopped with ${rejected.length} rejected append(s): ${rejected[0]?.rejection?.detail ?? "unknown"}`);
  return {
    ok: true,
    snapshotFingerprint,
    snapshotId: expectedSnapshotId,
    batchFingerprint: expectedBatchFingerprint,
    eventCount: records.length,
    appended: receipts.filter((r) => r.written).length,
    duplicateNoop: receipts.filter((r) => r.outcome === "DUPLICATE_NOOP").length,
  };
}

if (import.meta.main) {
  executeProductionBaseline(process.env)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
