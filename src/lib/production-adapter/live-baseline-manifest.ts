import {
  applyInventoryBaselineReconciliations,
  isReconciledBaselineReady,
  type InventoryBaselineReconciliation,
} from "../state-engine/inventory-reconciliation";
import { buildInventoryBaseline, type InventoryBaselineRow } from "../state-engine/inventory-baseline";
import { hashOf } from "../state-engine/hash";
import { resolveAirtableConfig, readOnlyFetch, type FetchLike } from "./airtable-rest-source";

export const INVENTORY_TABLE_ID = "tblN5ZnsivyfIQKnE";
export const RECONCILIATIONS_TABLE_ID = "tbl42NyhXosHPiCpX";

// Use immutable Airtable field IDs at the REST boundary. This avoids any
// ambiguity from field-name resolution while preserving the response shape
// consumed below (Airtable returns the requested fields under their names).
const INVENTORY_FIELDS = [
  "fld58iyqxlpG04WGN", // Item
  "fldAtqN53EWTGsYBH", // Quantity
  "fldNAS3ubie509gtt", // Unit
  "fld827WKdtfBVP5fT", // Status
  "fldkI4brbFEppTgW3", // Notes
] as const;
const RECONCILIATION_FIELDS = [
  "fldzwJl3oMkaGKSLC", // Inventory record ID
  "flde1REBRL629ubxe", // Disposition
  "fldjNfmYDaRNUkkWv", // Reason
  "fldwwFWQTl2K5dIdS", // Evidence
] as const;

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

function selectName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
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
  const reconciliations = await listTableRows(
    safeFetch,
    config,
    RECONCILIATIONS_TABLE_ID,
    RECONCILIATION_FIELDS,
  );

  const rows: InventoryBaselineRow[] = inventory.map((record) => ({
    recordId: record.id,
    item: typeof record.fields.Item === "string" ? record.fields.Item : "",
    quantity:
      typeof record.fields.Quantity === "number"
        ? record.fields.Quantity
        : record.fields.Quantity == null
          ? null
          : undefined,
    unit: typeof record.fields.Unit === "string" ? record.fields.Unit : undefined,
    status: selectName(record.fields.Status),
    notes: typeof record.fields.Notes === "string" ? record.fields.Notes : undefined,
  }));

  const decisions: InventoryBaselineReconciliation[] = reconciliations.map((record) => ({
    recordId:
      typeof record.fields["Inventory record ID"] === "string"
        ? record.fields["Inventory record ID"]
        : "",
    disposition: selectName(record.fields.Disposition) as InventoryBaselineReconciliation["disposition"],
    reason: typeof record.fields.Reason === "string" ? record.fields.Reason : "",
    evidence: typeof record.fields.Evidence === "string" ? record.fields.Evidence : "",
  }));

  const rawSnapshot = {
    inventory: inventory
      .map((record) => ({ id: record.id, fields: record.fields }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    reconciliations: reconciliations
      .map((record) => ({ id: record.id, fields: record.fields }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const snapshotFingerprint = hashOf(rawSnapshot);

  const baseline = buildInventoryBaseline(rows, baselineTimestamp);
  const reconciled = applyInventoryBaselineReconciliations(rows, baselineTimestamp, decisions);

  return {
    ok: true,
    mode: "READ_ONLY",
    baselineTimestamp,
    snapshotFingerprint,
    inventoryRecordCount: rows.length,
    reconciliationDecisionCount: reconciled.reconciliations.length,
    baselineId: baseline.baselineId,
    reconciledBaselineId: reconciled.baselineId,
    eventCount: reconciled.events.length,
    itemUnitGroupCount: new Set(
      reconciled.events.map(
        (event) =>
          `${event.itemKey}\u0000${typeof event.payload.unit === "string" ? event.payload.unit : ""}`,
      ),
    ).size,
    unresolvedExceptionCount: reconciled.unresolvedExceptions.length,
    reconciledReady: isReconciledBaselineReady(reconciled),
  };
}
