/**
 * Bounded Airtable write helper for Production INVENTORY materialisation.
 *
 * The only mutations this file can perform are:
 * - create/update rows in the canonical INVENTORY table, and
 * - set `Replay status` = Applied on existing HOUSEHOLD EVENTS rows.
 *
 * It can never create, edit or delete a HOUSEHOLD EVENTS record, and it never
 * invents a value: every quantity/unit/provenance string comes from the plan.
 */

import { INVENTORY_TABLE_ID } from "../production-adapter/live-baseline-manifest";
import type { FetchLike } from "../production-adapter/airtable-rest-source";
import type { InventoryRow, MaterialisationLine, MaterialisationPort } from "./types";

const INVENTORY_FIELD_IDS = {
  Item: "fld58iyqxlpG04WGN",
  Quantity: "fldAtqN53EWTGsYBH",
  Unit: "fldNAS3ubie509gtt",
  Status: "fld827WKdtfBVP5fT",
  Notes: "fldkI4brbFEppTgW3",
} as const;

const APPLIED_STATUS = "Applied";
const MAX_PAGES = 50;
const PAGE_SIZE = 100;
const BATCH_SIZE = 10;

export interface AirtableMaterialisationPortOptions {
  apiKey: string;
  baseId: string;
  eventsTable: string;
  fetchImpl: FetchLike;
  apiUrl?: string;
  /** Lovable gateway bearer token when `apiKey` is a connector connection key. */
  gatewayApiKey?: string;
  /** Status written on materialised INVENTORY rows. */
  inventoryStatus?: string;
}

function headers(apiKey: string, gatewayApiKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${gatewayApiKey ?? apiKey}`,
    ...(gatewayApiKey ? { "X-Connection-Api-Key": apiKey } : {}),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createAirtableMaterialisationPort(
  options: AirtableMaterialisationPortOptions,
): MaterialisationPort {
  const apiUrl = options.apiUrl ?? "https://api.airtable.com";
  const base = encodeURIComponent(options.baseId);
  const status = options.inventoryStatus ?? "Materialised";

  async function list(table: string, fields: readonly string[]): Promise<{ id: string; fields: Record<string, unknown> }[]> {
    const rows: { id: string; fields: Record<string, unknown> }[] = [];
    let offset: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
      for (const field of fields) params.append("fields[]", field);
      if (offset) params.set("offset", offset);

      const response = await options.fetchImpl(
        `${apiUrl}/v0/${base}/${encodeURIComponent(table)}?${params.toString()}`,
        { method: "GET", headers: headers(options.apiKey, options.gatewayApiKey) },
      );
      if (!response.ok) {
        throw new Error(`Airtable read failed [${response.status}] for ${table}: ${await response.text()}`);
      }
      const payload = (await response.json()) as { records?: { id?: unknown; fields?: unknown }[]; offset?: unknown };
      if (!payload || !Array.isArray(payload.records)) {
        throw new Error(`Airtable read for ${table} returned no records array; refusing a partial read.`);
      }
      for (const record of payload.records) {
        if (typeof record.id !== "string") throw new Error(`Airtable ${table} record is missing its record id.`);
        rows.push({ id: record.id, fields: (record.fields ?? {}) as Record<string, unknown> });
      }
      offset = typeof payload.offset === "string" ? payload.offset : undefined;
      if (!offset) return rows;
    }
    throw new Error(`Airtable read for ${table} exceeded ${MAX_PAGES} pages; refusing a partial snapshot.`);
  }

  function inventoryFields(line: MaterialisationLine): Record<string, unknown> {
    return {
      [INVENTORY_FIELD_IDS.Item]: line.itemKey,
      [INVENTORY_FIELD_IDS.Quantity]: line.quantity,
      [INVENTORY_FIELD_IDS.Unit]: line.unit,
      [INVENTORY_FIELD_IDS.Status]: status,
      [INVENTORY_FIELD_IDS.Notes]: line.notes,
    };
  }

  return {
    portId: "airtable-production-inventory-materialisation",

    async listInventory(): Promise<InventoryRow[]> {
      const rows = await list(INVENTORY_TABLE_ID, Object.values(INVENTORY_FIELD_IDS));
      return rows.map((row) => ({
        recordId: row.id,
        item: text(row.fields[INVENTORY_FIELD_IDS.Item] ?? row.fields["Item"]),
        quantity: numeric(row.fields[INVENTORY_FIELD_IDS.Quantity] ?? row.fields["Quantity"]),
        unit: text(row.fields[INVENTORY_FIELD_IDS.Unit] ?? row.fields["Unit"]),
        status: text(row.fields[INVENTORY_FIELD_IDS.Status] ?? row.fields["Status"]) || null,
        notes: text(row.fields[INVENTORY_FIELD_IDS.Notes] ?? row.fields["Notes"]) || null,
      }));
    },

    async createInventoryRow(line) {
      const response = await options.fetchImpl(`${apiUrl}/v0/${base}/${encodeURIComponent(INVENTORY_TABLE_ID)}`, {
        method: "POST",
        headers: headers(options.apiKey, options.gatewayApiKey),
        body: JSON.stringify({ records: [{ fields: inventoryFields(line) }], typecast: false }),
      });
      if (!response.ok) {
        throw new Error(`Airtable INVENTORY create failed [${response.status}]: ${await response.text()}`);
      }
      const payload = (await response.json()) as { records?: { id?: unknown }[] };
      const recordId = payload.records?.[0]?.id;
      if (typeof recordId !== "string") throw new Error("Airtable INVENTORY create returned no record id.");
      return { recordId };
    },

    async updateInventoryRow(recordId, line) {
      const response = await options.fetchImpl(`${apiUrl}/v0/${base}/${encodeURIComponent(INVENTORY_TABLE_ID)}`, {
        method: "PATCH",
        headers: headers(options.apiKey, options.gatewayApiKey),
        body: JSON.stringify({ records: [{ id: recordId, fields: inventoryFields(line) }], typecast: false }),
      });
      if (!response.ok) {
        throw new Error(`Airtable INVENTORY update failed [${response.status}]: ${await response.text()}`);
      }
    },

    async markEventsReplayed(eventIds) {
      if (eventIds.length === 0) return { updatedEventIds: [] };
      const wanted = new Set(eventIds);
      const rows = await list(options.eventsTable, ["Event ID", "Replay status"]);
      const targets = rows.filter(
        (row) => wanted.has(text(row.fields["Event ID"])) && text(row.fields["Replay status"]) !== APPLIED_STATUS,
      );

      const updated: string[] = [];
      for (let index = 0; index < targets.length; index += BATCH_SIZE) {
        const batch = targets.slice(index, index + BATCH_SIZE);
        const response = await options.fetchImpl(`${apiUrl}/v0/${base}/${encodeURIComponent(options.eventsTable)}`, {
          method: "PATCH",
          headers: headers(options.apiKey, options.gatewayApiKey),
          body: JSON.stringify({
            records: batch.map((row) => ({ id: row.id, fields: { "Replay status": APPLIED_STATUS } })),
            typecast: false,
          }),
        });
        if (!response.ok) {
          throw new Error(`Airtable replay-status update failed [${response.status}]: ${await response.text()}`);
        }
        for (const row of batch) updated.push(text(row.fields["Event ID"]));
      }
      return { updatedEventIds: updated };
    },
  };
}
