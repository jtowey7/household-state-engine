import { hashOf } from "../src/lib/state-engine/hash";
import { mapHouseholdEventRows, type AirtableRow } from "../src/lib/production-adapter/airtable-port";
import type { FetchLike } from "../src/lib/production-adapter/airtable-rest-source";

const INVENTORY = "tblN5ZnsivyfIQKnE";
const EVENTS = "tbluDjPNJ3hxUpWxN";
const ITEM_KEY_MAP = "tblVCfZIPorlqAcGA";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const DELIVERY_EVIDENCE = "DELIVERY-EVIDENCE:cbf2853db337947148d5dd8be87c4b0e";
const APPROVAL_ACTOR = "James";
const REQUIRED_EXECUTION_CONFIRMATION = "CONFIRM_APPROVED_DELIVERY_INVENTORY";
const INVENTORY_FIELDS = ["fld58iyqxlpG04WGN", "fldAtqN53EWTGsYBH", "fldNAS3ubie509gtt", "fld827WKdtfBVP5fT", "fldkI4brbFEppTgW3", "fldlai33y97cNL8bl", "fldUmK8MiUb5g4UHM"];
const EVENT_FIELDS = ["fld0eOLFhMirrp3sp", "fldofNnuJSzaZBgO9", "fldllmvZqSOV8wRVB", "fldYu9adTO1Jj3CfT", "flddW9gBfP3MeaLbT", "fldyzlpssmG8TykGG", "fld3t0OMEE5XmMg85", "fld01W4Pp3V3DQQQ3", "fldlfhMmN1nceWZN8", "fldzu1QfNZwhGAeln"];
const MAP_FIELDS = ["fldh7V3WOUyIK4Z50", "fldXBC0Fgk2c71hw4", "fldSTLFCWqngzNdim", "fldPOD5tElUhQf23L", "fldUCqeoFEOMbcjaA"];
const REPLAY_STATUS_FIELD = "fldlfhMmN1nceWZN8";

type Row = { id: string; fields: Record<string, unknown> };
type InventoryProjection = { item: string; quantity: number; unit: string; sourceEventIds: string[]; occurredAt: string };
function required(env: Record<string, string | undefined>, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`Production delivery inventory materialisation refused: missing ${key}`); return value; }
function value(fields: Record<string, unknown>, id: string, name: string): unknown { return fields[id] ?? fields[name]; }
function selectName(input: unknown): string | undefined { if (typeof input === "string") return input; if (input && typeof input === "object" && "name" in input) { const name = (input as { name?: unknown }).name; return typeof name === "string" ? name : undefined; } return undefined; }

async function listRows(fetchImpl: FetchLike, apiKey: string, baseId: string, tableId: string, fields: string[]): Promise<Row[]> {
  const rows: Row[] = []; let offset: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) }); for (const field of fields) params.append("fields[]", field); if (offset) params.set("offset", offset);
    const response = await fetchImpl(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`Airtable read failed [${response.status}] for ${tableId}: ${await response.text()}`);
    const payload = (await response.json()) as { records?: { id?: unknown; fields?: unknown }[]; offset?: unknown };
    if (!Array.isArray(payload.records)) throw new Error(`Airtable read for ${tableId} returned no records array; refusing partial state.`);
    for (const record of payload.records) { if (typeof record.id !== "string") throw new Error(`Airtable ${tableId} record is missing its record ID.`); rows.push({ id: record.id, fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : {} }); }
    offset = typeof payload.offset === "string" ? payload.offset : undefined; if (!offset) return rows;
  }
  throw new Error(`Airtable read for ${tableId} exceeded ${MAX_PAGES} pages; refusing partial state.`);
}

function eventRowsForDelivery(rows: Row[]): Row[] {
  return rows.filter((row) => {
    const fields = row.fields;
    const status = selectName(value(fields, REPLAY_STATUS_FIELD, "Replay status"));
    return selectName(value(fields, "fldofNnuJSzaZBgO9", "Event type")) === "Delivery" && selectName(value(fields, "fldzu1QfNZwhGAeln", "Record class")) === "Production" && value(fields, "fld01W4Pp3V3DQQQ3", "Evidence")?.toString().includes(DELIVERY_EVIDENCE) && (status === "Pending" || status === "Applied");
  });
}

function maps(rows: Row[]): Map<string, { item: string; recipeUnit: string; canonicalUnit: string }> {
  const result = new Map<string, { item: string; recipeUnit: string; canonicalUnit: string }>();
  for (const row of rows) {
    const f = row.fields; const alias = value(f, "fldh7V3WOUyIK4Z50", "Recipe item alias"); const item = value(f, "fldXBC0Fgk2c71hw4", "Canonical household item key"); const recipeUnit = value(f, "fldSTLFCWqngzNdim", "Recipe unit"); const canonicalUnit = value(f, "fldPOD5tElUhQf23L", "Canonical unit"); const active = value(f, "fldUCqeoFEOMbcjaA", "Active");
    if (active === true && typeof alias === "string" && typeof item === "string" && typeof recipeUnit === "string" && typeof canonicalUnit === "string") { if (result.has(alias) && result.get(alias)!.item !== item) throw new Error(`Delivery inventory materialisation refused: ambiguous ITEM KEY MAP alias ${alias}.`); result.set(alias, { item, recipeUnit, canonicalUnit }); }
  }
  return result;
}

export function buildDeliveryProjection(eventRows: AirtableRow[], mapRows: AirtableRow[]): InventoryProjection[] {
  const mapped = mapHouseholdEventRows(eventRows);
  if (mapped.invalid.length > 0) throw new Error(`Delivery inventory materialisation refused: ${mapped.invalid.length} invalid canonical event row(s).`);
  if (mapped.unsupported.length > 0) throw new Error(`Delivery inventory materialisation refused: ${mapped.unsupported.length} unsupported event row(s).`);
  const lookup = maps(mapRows); const byItem = new Map<string, InventoryProjection>();
  for (const event of mapped.events) {
    if (event.recordClass !== "Production") continue;
    const targetItem = lookup.get(event.itemKey)?.item ?? event.itemKey; const targetUnit = event.payload.unit;
    if (!targetUnit) throw new Error(`Delivery inventory materialisation refused: missing unit for ${event.eventId}.`);
    const quantity = event.payload.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) throw new Error(`Delivery inventory materialisation refused: invalid positive delivery quantity for ${event.eventId}.`);
    const prior = byItem.get(targetItem);
    if (prior) { if (prior.unit !== targetUnit) throw new Error(`Delivery inventory materialisation refused: unit conflict for ${targetItem}.`); prior.quantity += quantity; prior.sourceEventIds.push(event.eventId); if (event.occurredAt > prior.occurredAt) prior.occurredAt = event.occurredAt; }
    else byItem.set(targetItem, { item: targetItem, quantity, unit: targetUnit, sourceEventIds: [event.eventId], occurredAt: event.occurredAt });
  }
  return [...byItem.values()].sort((a, b) => a.item.localeCompare(b.item));
}

function markerFor(eventIds: string[]): string { return `FOODOS_DELIVERY_MATERIALISED:${hashOf([...eventIds].sort())}`; }
function existingInventory(rows: Row[]): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of rows) { const item = value(row.fields, "fld58iyqxlpG04WGN", "Item"); if (typeof item !== "string" || !item.trim()) continue; if (result.has(item)) throw new Error(`Delivery inventory materialisation refused: duplicate Production INVENTORY item identity ${item}.`); result.set(item, row); }
  return result;
}

export function buildInventoryUpdates(projection: InventoryProjection[], inventoryRows: AirtableRow[], deliveredDate: string): Array<{ id?: string; fields: Record<string, unknown>; item: string; applied: boolean }> {
  const existing = existingInventory(inventoryRows); const updates: Array<{ id?: string; fields: Record<string, unknown>; item: string; applied: boolean }> = [];
  for (const item of projection) {
    const marker = markerFor(item.sourceEventIds); const row = existing.get(item.item);
    if (!row) { updates.push({ item: item.item, applied: true, fields: { Item: item.item, Quantity: item.quantity, Unit: item.unit, Status: "OK", "Source / Supermarket": "Tesco", Delivered: deliveredDate, Notes: `${marker}\nSource event IDs: ${item.sourceEventIds.join(", ")}` } }); continue; }
    const notes = typeof value(row.fields, "fldkI4brbFEppTgW3", "Notes") === "string" ? value(row.fields, "fldkI4brbFEppTgW3", "Notes") as string : "";
    if (notes.includes(marker)) { updates.push({ id: row.id, item: item.item, applied: false, fields: {} }); continue; }
    const currentQuantity = value(row.fields, "fldAtqN53EWTGsYBH", "Quantity"); const currentUnit = selectName(value(row.fields, "fldNAS3ubie509gtt", "Unit"));
    if (typeof currentQuantity !== "number" || !Number.isFinite(currentQuantity)) throw new Error(`Delivery inventory materialisation refused: ${item.item} has no numeric current quantity.`);
    if (currentUnit !== item.unit) throw new Error(`Delivery inventory materialisation refused: ${item.item} unit ${currentUnit ?? "missing"} differs from delivered ${item.unit}.`);
    updates.push({ id: row.id, item: item.item, applied: true, fields: { Quantity: currentQuantity + item.quantity, "Source / Supermarket": "Tesco", Delivered: deliveredDate, Notes: `${notes}${notes ? "\n" : ""}${marker}\nSource event IDs: ${item.sourceEventIds.join(", ")}` } });
  }
  return updates;
}

async function writeInventoryBatches(fetchImpl: FetchLike, apiKey: string, baseId: string, updates: Array<{ id?: string; fields: Record<string, unknown> }>): Promise<void> {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(INVENTORY)}`;
  const patch = updates.filter((x) => !!x.id); const create = updates.filter((x) => !x.id);
  for (let i = 0; i < patch.length; i += 10) { const batch = patch.slice(i, i + 10); const response = await fetchImpl(url, { method: "PATCH", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ records: batch.map((x) => ({ id: x.id, fields: x.fields })) }) }); if (!response.ok) throw new Error(`Airtable inventory update failed [${response.status}]: ${await response.text()}`); }
  for (let i = 0; i < create.length; i += 10) { const batch = create.slice(i, i + 10); const response = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ records: batch.map((x) => ({ fields: x.fields })) }) }); if (!response.ok) throw new Error(`Airtable inventory create failed [${response.status}]: ${await response.text()}`); }
}

async function markEventsApplied(fetchImpl: FetchLike, apiKey: string, baseId: string, eventRows: Row[]): Promise<void> {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(EVENTS)}`;
  for (let i = 0; i < eventRows.length; i += 10) {
    const batch = eventRows.slice(i, i + 10);
    const response = await fetchImpl(url, { method: "PATCH", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ records: batch.map((row) => ({ id: row.id, fields: { [REPLAY_STATUS_FIELD]: "Applied" } })) }) });
    if (!response.ok) throw new Error(`Airtable event replay-status update failed [${response.status}]: ${await response.text()}`);
  }
}

export async function executeProductionDeliveryInventory(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch as FetchLike): Promise<{ ok: true; applied: number; skipped: number; projectionFingerprint: string }> {
  if (env.FOODOS_DELIVERY_INVENTORY_EXECUTE !== REQUIRED_EXECUTION_CONFIRMATION) throw new Error("Production delivery inventory materialisation is fail-closed; explicit execution confirmation is required.");
  if (env.FOODOS_DELIVERY_APPROVED_BY !== APPROVAL_ACTOR) throw new Error("Production delivery inventory materialisation refused: approval actor must be James.");
  if (env.FOODOS_DELIVERY_EVIDENCE !== DELIVERY_EVIDENCE) throw new Error("Production delivery inventory materialisation refused: evidence digest is not the approved current delivery evidence.");
  const apiKey = required(env, "AIRTABLE_API_KEY"); const baseId = required(env, "AIRTABLE_BASE_ID");
  const events = await listRows(fetchImpl, apiKey, baseId, EVENTS, EVENT_FIELDS); const inventory = await listRows(fetchImpl, apiKey, baseId, INVENTORY, INVENTORY_FIELDS); const itemMaps = await listRows(fetchImpl, apiKey, baseId, ITEM_KEY_MAP, MAP_FIELDS);
  const deliveryEvents = eventRowsForDelivery(events);
  if (deliveryEvents.length !== 22) throw new Error(`Production delivery inventory materialisation refused: expected exactly 22 approved delivery events (Pending/Applied), found ${deliveryEvents.length}.`);
  const projection = buildDeliveryProjection(deliveryEvents, itemMaps); const fingerprint = hashOf(projection); const updates = buildInventoryUpdates(projection, inventory, required(env, "FOODOS_DELIVERY_DATE"));
  const toWrite = updates.filter((u) => u.applied).map(({ id, fields }) => ({ id, fields }));
  await writeInventoryBatches(fetchImpl, apiKey, baseId, toWrite);
  await markEventsApplied(fetchImpl, apiKey, baseId, deliveryEvents);
  return { ok: true, applied: toWrite.length, skipped: updates.length - toWrite.length, projectionFingerprint: fingerprint };
}

if (import.meta.main) {
  executeProductionDeliveryInventory(process.env).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
