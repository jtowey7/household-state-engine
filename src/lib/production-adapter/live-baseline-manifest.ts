import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
} from "../state-engine/inventory-reconciliation";
import { buildInventoryBaseline, type InventoryBaselineRow } from "../state-engine/inventory-baseline";
import { hashOf } from "../state-engine/hash";
import { canonicaliseAppend } from "../event-writer/canonical";
import { batchFingerprintFor } from "../event-writer/baseline-batch";
import { resolveAirtableConfig, readOnlyFetch, type FetchLike } from "./airtable-rest-source";

export const INVENTORY_TABLE_ID = "tblN5ZnsivyfIQKnE";
export const RECONCILIATIONS_TABLE_ID = "tbl42NyhXosHPiCpX";

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

const INVENTORY_FIELD_IDS = {
  Item: "fld58iyqxlpG04WGN",
  Quantity: "fldAtqN53EWTGsYBH",
  Unit: "fldNAS3ubie509gtt",
  Status: "fld827WKdtfBVP5fT",
  Notes: "fldkI4brbFEppTgW3",
} as const;
const RECONCILIATION_FIELD_IDS = {
  "Inventory record ID": "fldzwJl3oMkaGKSLC",
  Disposition: "flde1REBRL629ubxe",
  Reason: "fldjNfmYDaRNUkkWv",
  Evidence: "fldwwFWQTl2K5dIdS",
} as const;

const MAX_PAGES = 50;
const PAGE_SIZE = 100;

interface AirtableListResponse {
  records?: { id?: unknown; fields?: unknown }[];
  offset?: unknown;
}

export interface LiveBaselineManifest {
  ok: true;
  mode: "READ_ONLY";
  baselineTimestamp: string;
  snapshotFingerprint: string;
  inventoryRecordCount: number;
  reconciliationDecisionCount: number;
  baselineId: string;
  reconciledBaselineId: string;
  batchFingerprint: string;
  eventCount: number;
  itemUnitGroupCount: number;
  unresolvedExceptionCount: number;
  reconciledReady: boolean;
}

async function listTableRows(
  fetchImpl: FetchLike,
  config: { apiKey: string; baseId: string },
  tableId: string,
  fields: readonly string[],
): Promise<{ id: string; fields: Record<string, unknown> }[]> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    for (const field of fields) params.append("fields[]", field);
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable read failed [${response.status}] for ${tableId}: ${body}`);
    }

    const payload = (await response.json()) as AirtableListResponse;
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error(`Airtable read for ${tableId} returned no records array; refusing partial read.`);
    }

    for (const record of payload.records) {
      const id = typeof record.id === "string" ? record.id : "";
      if (!id) throw new Error(`Airtable ${tableId} record is missing its record id.`);
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

  throw new Error(`Airtable read for ${tableId} exceeded ${MAX_PAGES} pages; refusing a partial snapshot.`);
}

function fieldValue(fields: Record<string, unknown>, fieldId: string, fieldName: string): unknown {
  return fields[fieldId] ?? fields[fieldName];
}

function selectName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function canonicalBaselineRecords(
  reconciled: ReturnType<typeof applyInventoryBaselineReconciliations>,
  timestamp: string,
) {
  return reconciled.events.map((event) => {
    const quantity = event.payload.quantity;
    const unit = event.payload.unit;
    if (typeof quantity !== "number" || typeof unit !== "string" || !unit.trim()) {
      throw new Error(`Baseline event ${event.eventId} lacks a canonical quantity/unit.`);
    }
    const result = canonicaliseAppend(
      {
        eventType: "Correction",
        item: event.itemKey,
        occurredAt: event.occurredAt,
        identityContext: event.eventId,
        stateAfter: quantity,
        unit,
        source: "INVENTORY_SNAPSHOT",
        actor: "Food OS baseline initialisation",
        entityType: "Inventory item",
        evidence: event.payload.note ?? `baseline:${event.eventId}`,
        confidence: "High",
        recordClass: "Production",
      },
      { now: () => timestamp },
    );
    if (!result.ok) {
      throw new Error(`Baseline event ${event.eventId} failed canonicalisation: ${result.rejection.detail}`);
    }
    return result.record;
  });
}

export async function buildLiveBaselineManifest(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<LiveBaselineManifest> {
  const resolution = resolveAirtableConfig(env);
  if (resolution.status !== "CONFIGURED") {
    throw new Error(`Airtable connector not configured (missing: ${resolution.missing.join(", ")})`);
  }

  const config = { apiKey: resolution.config.apiKey, baseId: resolution.config.baseId };
  const safeFetch = readOnlyFetch(fetchImpl);
  const baselineTimestamp = new Date().toISOString();

  const inventory = await listTableRows(safeFetch, config, INVENTORY_TABLE_ID, INVENTORY_FIELDS);
  const reconciliations = await listTableRows(safeFetch, config, RECONCILIATIONS_TABLE_ID, RECONCILIATION_FIELDS);

  const rows: InventoryBaselineRow[] = inventory.map((record) => {
    const item = fieldValue(record.fields, INVENTORY_FIELD_IDS.Item, "Item");
    const quantity = fieldValue(record.fields, INVENTORY_FIELD_IDS.Quantity, "Quantity");
    const unit = fieldValue(record.fields, INVENTORY_FIELD_IDS.Unit, "Unit");
    const status = fieldValue(record.fields, INVENTORY_FIELD_IDS.Status, "Status");
    const notes = fieldValue(record.fields, INVENTORY_FIELD_IDS.Notes, "Notes");

    return {
      recordId: record.id,
      item: typeof item === "string" ? item : "",
      quantity: typeof quantity === "number" ? quantity : quantity == null ? null : undefined,
      unit: typeof unit === "string" ? unit : undefined,
      status: selectName(status),
      notes: typeof notes === "string" ? notes : undefined,
    };
  });

  const decisions: InventoryBaselineReconciliation[] = reconciliations.map((record) => {
    const recordId = fieldValue(record.fields, RECONCILIATION_FIELD_IDS["Inventory record ID"], "Inventory record ID");
    const disposition = fieldValue(record.fields, RECONCILIATION_FIELD_IDS.Disposition, "Disposition");
    const reason = fieldValue(record.fields, RECONCILIATION_FIELD_IDS.Reason, "Reason");
    const evidence = fieldValue(record.fields, RECONCILIATION_FIELD_IDS.Evidence, "Evidence");

    return {
      recordId: typeof recordId === "string" ? recordId : "",
      disposition: selectName(disposition) as InventoryBaselineReconciliation["disposition"],
      reason: typeof reason === "string" ? reason : "",
      evidence: typeof evidence === "string" ? evidence : "",
    };
  });

  const rawSnapshot = {
    inventory: inventory.map((record) => ({ id: record.id, fields: record.fields })).sort((a, b) => a.id.localeCompare(b.id)),
    reconciliations: reconciliations.map((record) => ({ id: record.id, fields: record.fields })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const snapshotFingerprint = hashOf(rawSnapshot);

  const baseline = buildInventoryBaseline(rows, baselineTimestamp);
  const reconciled = applyInventoryBaselineReconciliations(rows, baselineTimestamp, decisions);
  if (!isReconciledBaselineReady(reconciled)) {
    return {
      ok: true,
      mode: "READ_ONLY",
      baselineTimestamp,
      snapshotFingerprint,
      inventoryRecordCount: rows.length,
      reconciliationDecisionCount: reconciled.reconciliations.length,
      baselineId: baseline.baselineId,
      reconciledBaselineId: reconciled.baselineId,
      batchFingerprint: "",
      eventCount: reconciled.events.length,
      itemUnitGroupCount: new Set(reconciled.events.map((event) => `${event.itemKey}\u0000${typeof event.payload.unit === "string" ? event.payload.unit : ""}`)).size,
      unresolvedExceptionCount: reconciled.unresolvedExceptions.length,
      reconciledReady: false,
    };
  }

  const canonicalRecords = canonicalBaselineRecords(reconciled, baselineTimestamp);

  return {
    ok: true,
    mode: "READ_ONLY",
    baselineTimestamp,
    snapshotFingerprint,
    inventoryRecordCount: rows.length,
    reconciliationDecisionCount: reconciled.reconciliations.length,
    baselineId: baseline.baselineId,
    reconciledBaselineId: reconciled.baselineId,
    batchFingerprint: batchFingerprintFor(canonicalRecords),
    eventCount: reconciled.events.length,
    itemUnitGroupCount: new Set(reconciled.events.map((event) => `${event.itemKey}\u0000${typeof event.payload.unit === "string" ? event.payload.unit : ""}`)).size,
    unresolvedExceptionCount: reconciled.unresolvedExceptions.length,
    reconciledReady: true,
  };
}
