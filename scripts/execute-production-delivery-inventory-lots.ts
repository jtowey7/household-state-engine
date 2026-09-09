import { hashOf } from "../src/lib/state-engine/hash";
import { mapHouseholdEventRows, type AirtableRow } from "../src/lib/production-adapter/airtable-port";
import type { FetchLike } from "../src/lib/production-adapter/airtable-rest-source";

const INVENTORY = "tblN5ZnsivyfIQKnE";
const EVENTS = "tbluDjPNJ3hxUpWxN";
const ITEM_KEY_MAP = "tblVCfZIPorlqAcGA";
const DELIVERY_EVIDENCE = "DELIVERY-EVIDENCE:cbf2853db337947148d5dd8be87c4b0e";
const APPROVAL_ACTOR = "James";
const REQUIRED_EXECUTION_CONFIRMATION = "CONFIRM_APPROVED_DELIVERY_INVENTORY";
const REPLAY_STATUS_FIELD = "fldlfhMmN1nceWZN8";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

type Row = { id: string; fields: Record<string, unknown> };
type Projection = { item: string; quantity: number; unit: string; sourceEventIds: string[]; occurredAt: string };

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Production delivery inventory materialisation refused: missing ${key}`);
  return value;
}
function value(fields: Record<string, unknown>, id: string, name: string): unknown { return fields[id] ?? fields[name]; }
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
    const response = await fetchImpl(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Airtable read failed [${response.status}] for ${tableId}: ${await response.text()}`);
    const payload = (await response.json()) as { records?: { id?: unknown; fields?: unknown }[]; offset?: unknown };
    if (!Array.isArray(payload.records)) throw new Error(`Airtable read for ${tableId} returned no records array; refusing partial state.`);
    for (const record of payload.records) {
      if (typeof record.id !== "string") throw new Error(`Airtable ${tableId} record is missing its record ID.`);
      rows.push({ id: record.id, fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : {} });
    }
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return rows;
  }
  throw new Error(`Airtable read for ${tableId} exceeded ${MAX_PAGES} pages; refusing partial state.`);
}

function deliveryRows(rows: Row[]): Row[] {
  return rows.filter((row) =>
    selectName(value(row.fields, "fldofNnuJSzaZBgO9", "Event type")) === "Delivery" &&
    selectName(value(row.fields, "fldzu1QfNZwhGAeln", "Record class")) === "Production" &&
    String(value(row.fields, "fld01W4Pp3V3DQQQ3", "Evidence") ?? "").includes(DELIVERY_EVIDENCE) &&
    ["Pending", "Applied"].includes(selectName(value(row.fields, REPLAY_STATUS_FIELD, "Replay status")) ?? "")
  );
}

function mapRows(rows: Row[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const f = row.fields;
    const alias = value(f, "fldh7V3WOUyIK4Z50", "Recipe item alias");
    const item = value(f, "fldXBC0Fgk2c71hw4", "Canonical household item key");
    const active = value(f, "fldUCqeoFEOMbcjaA", "Active");
    if (active === true && typeof alias === "string" && typeof item === "string") {
      if (result.has(alias) && result.get(alias) !== item) throw new Error(`Delivery inventory materialisation refused: ambiguous ITEM KEY MAP alias ${alias}.`);
      result.set(alias, item);
    }
  }
  return result;
}

function projection(events: Row[], maps: Row[]): Projection[] {
  const mapped = mapHouseholdEventRows(events);
  if (mapped.invalid.length || mapped.unsupported.length) throw new Error(`Delivery inventory materialisation refused: invalid=${mapped.invalid.length}, unsupported=${mapped.unsupported.length}.`);
  const lookup = mapRows(maps);
  const byItem = new Map<string, Projection>();
  for (const event of mapped.events) {
    if (event.recordClass !== "Production") continue;
    const item = lookup.get(event.itemKey) ?? event.itemKey;
    const quantity = event.payload.quantity;
    const unit = event.payload.unit;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || !unit) throw new Error(`Delivery inventory materialisation refused: invalid quantity/unit for ${event.eventId}.`);
    const prior = byItem.get(item);
    if (!prior) byItem.set(item, { item, quantity, unit, sourceEventIds: [event.eventId], occurredAt: event.occurredAt });
    else {
      if (prior.unit !== unit) throw new Error(`Delivery inventory materialisation refused: unit conflict for ${item}.`);
      prior.quantity += quantity;
      prior.sourceEventIds.push(event.eventId);
      if (event.occurredAt > prior.occurredAt) prior.occurredAt = event.occurredAt;
    }
  }
  return [...byItem.values()].sort((a, b) => a.item.localeCompare(b.item));
}

function markerFor(eventIds: string[]): string { return `FOODOS_DELIVERY_MATERIALISED:${hashOf([...eventIds].sort())}`; }

async function writeNewLots(fetchImpl: FetchLike, apiKey: string, baseId: string, inventoryRows: Row[], projectionRows: Projection[], deliveredDate: string): Promise<{ applied: number; skipped: number }> {
  const existingNotes = inventoryRows.map((row) => String(value(row.fields, "fldkI4brbFEppTgW3", "Notes") ?? ""));
  const toCreate = projectionRows.filter((item) => !existingNotes.some((notes) => notes.includes(markerFor(item.sourceEventIds))));
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(INVENTORY)}`;
  for (let i = 0; i < toCreate.length; i += 10) {
    const batch = toCreate.slice(i, i + 10);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ records: batch.map((item) => ({ fields: {
        Item: item.item,
        Quantity: item.quantity,
        Unit: item.unit,
        Status: "OK",
        "Source / Supermarket": "Tesco",
        Delivered: deliveredDate,
        Notes: `${markerFor(item.sourceEventIds)}\nSource event IDs: ${item.sourceEventIds.join(", ")}`,
      } })) }),
    });
    if (!response.ok) throw new Error(`Airtable inventory create failed [${response.status}]: ${await response.text()}`);
  }
  return { applied: toCreate.length, skipped: projectionRows.length - toCreate.length };
}

async function markApplied(fetchImpl: FetchLike, apiKey: string, baseId: string, events: Row[]): Promise<void> {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(EVENTS)}`;
  for (let i = 0; i < events.length; i += 10) {
    const batch = events.slice(i, i + 10);
    const response = await fetchImpl(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ records: batch.map((row) => ({ id: row.id, fields: { [REPLAY_STATUS_FIELD]: "Applied" } })) }),
    });
    if (!response.ok) throw new Error(`Airtable event replay-status update failed [${response.status}]: ${await response.text()}`);
  }
}

export async function executeProductionDeliveryInventoryLots(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch as FetchLike): Promise<{ ok: true; applied: number; skipped: number; projectionFingerprint: string }> {
  if (env.FOODOS_DELIVERY_INVENTORY_EXECUTE !== REQUIRED_EXECUTION_CONFIRMATION) throw new Error("Production delivery inventory materialisation is fail-closed; explicit execution confirmation is required.");
  if (env.FOODOS_DELIVERY_APPROVED_BY !== APPROVAL_ACTOR) throw new Error("Production delivery inventory materialisation refused: approval actor must be James.");
  if (env.FOODOS_DELIVERY_EVIDENCE !== DELIVERY_EVIDENCE) throw new Error("Production delivery inventory materialisation refused: evidence digest is not the approved current delivery evidence.");
  const apiKey = required(env, "AIRTABLE_API_KEY");
  const baseId = required(env, "AIRTABLE_BASE_ID");
  const events = await listRows(fetchImpl, apiKey, baseId, EVENTS, ["fld0eOLFhMirrp3sp", "fldofNnuJSzaZBgO9", "fldllmvZqSOV8wRVB", "fldYu9adTO1Jj3CfT", "flddW9gBfP3MeaLbT", "fldyzlpssmG8TykGG", "fld3t0OMEE5XmMg85", "fld01W4Pp3V3DQQQ3", REPLAY_STATUS_FIELD, "fldzu1QfNZwhGAeln"]);
  const inventory = await listRows(fetchImpl, apiKey, baseId, INVENTORY, ["fld58iyqxlpG04WGN", "fldAtqN53EWTGsYBH", "fldNAS3ubie509gtt", "fld827WKdtfBVP5fT", "fldkI4brbFEppTgW3", "fldlai33y97cNL8bl", "fldUmK8MiUb5g4UHM"]);
  const maps = await listRows(fetchImpl, apiKey, baseId, ITEM_KEY_MAP, ["fldh7V3WOUyIK4Z50", "fldXBC0Fgk2c71hw4", "fldUCqeoFEOMbcjaA"]);
  const approved = deliveryRows(events);
  if (approved.length !== 22) throw new Error(`Production delivery inventory materialisation refused: expected exactly 22 approved delivery events (Pending/Applied), found ${approved.length}.`);
  const projected = projection(approved, maps);
  const fingerprint = hashOf(projected);
  const result = await writeNewLots(fetchImpl, apiKey, baseId, inventory, projected, required(env, "FOODOS_DELIVERY_DATE"));
  await markApplied(fetchImpl, apiKey, baseId, approved);
  return { ok: true, ...result, projectionFingerprint: fingerprint };
}

if (import.meta.main) {
  executeProductionDeliveryInventoryLots(process.env).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
