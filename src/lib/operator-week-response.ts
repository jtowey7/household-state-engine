import { authorizeOperatorSession } from "./operator-read-auth";
import { createAirtableRestRowSource, resolveAirtableConfig, type FetchLike } from "./production-adapter/airtable-rest-source";
import { createEvidenceAwareAirtableProductionPort } from "./production-adapter/evidence-aware-port";
import { loadProductionState } from "./production-adapter/adapter";
import { replayEvents, toQuantityRequirementsHandoff } from "./state-engine/engine";

const AIRTABLE_API_URL = "https://api.airtable.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const TABLES = {
  mealPlans: "MEAL PLANS",
  quantityRequirements: "QUANTITY REQUIREMENTS",
  preferences: "PREFERENCES",
} as const;

const MEAL_PLAN_FIELDS = [
  "Meal",
  "Date",
  "Meal type",
  "Method",
  "Why this meal",
  "Leftovers",
  "Status",
  "Record class",
];

const QUANTITY_FIELDS = [
  "Requirement",
  "Meal",
  "Item",
  "Required quantity",
  "Unit",
  "Calculation status",
  "Household state snapshot ID",
  "State reconciliation status",
];

const PREFERENCE_FIELDS = ["Preference", "Category", "Importance", "Seasonal", "Evidence/source", "Active"];

type WorkerEnvironment = Record<string, unknown>;

interface AirtableRecord {
  id?: unknown;
  fields?: unknown;
}

interface AirtableListResponse {
  records?: AirtableRecord[];
  offset?: unknown;
}

function readString(env: WorkerEnvironment | undefined, key: string): string | undefined {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildEnvironment(env: WorkerEnvironment | undefined): Record<string, string | undefined> {
  return {
    AIRTABLE_API_KEY: readString(env, "AIRTABLE_API_KEY"),
    AIRTABLE_FOOD_OS_BASE_ID: readString(env, "AIRTABLE_FOOD_OS_BASE_ID"),
    AIRTABLE_HOUSEHOLD_EVENTS_TABLE: readString(env, "AIRTABLE_HOUSEHOLD_EVENTS_TABLE"),
  };
}

function tableUrl(baseId: string, table: string, fields: string[], extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  params.set("pageSize", String(PAGE_SIZE));
  for (const field of fields) params.append("fields[]", field);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${AIRTABLE_API_URL}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}?${params.toString()}`;
}

async function listTable(
  config: { apiKey: string; baseId: string },
  table: string,
  fields: string[],
  extra: Record<string, string> = {},
): Promise<AirtableRecord[]> {
  const rows: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = { ...extra };
    if (offset) params.offset = offset;
    const response = await (fetch as unknown as FetchLike)(tableUrl(config.baseId, table, fields, params), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Airtable read failed [${response.status}] for ${table}: ${await response.text()}`);
    const payload = (await response.json()) as AirtableListResponse;
    if (!Array.isArray(payload.records)) throw new Error(`Airtable read returned no records array for ${table}`);
    rows.push(...payload.records);
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return rows;
  }
  throw new Error(`Airtable read exceeded ${MAX_PAGES} pages for ${table}`);
}

function field(record: AirtableRecord, name: string): unknown {
  return record.fields && typeof record.fields === "object"
    ? (record.fields as Record<string, unknown>)[name]
    : undefined;
}

function linkedNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string" ? [(entry as { name: string }).name] : []))
    : [];
}

function linkedIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" ? [(entry as { id: string }).id] : []))
    : [];
}

function selectName(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
    ? (value as { name: string }).name
    : undefined;
}

function isProduction(value: unknown): boolean {
  return selectName(value) === "Production";
}

/**
 * Authenticated, read-only composition boundary for the real weekly household
 * view. The browser never receives Airtable credentials or the production-read
 * token. No write operation exists in this module.
 */
export async function operatorWeekResponse(
  request: Request,
  workerEnv: WorkerEnvironment | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/runtime/operator/session" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const { createOperatorSession } = await import("./operator-read-auth");
    return createOperatorSession(token, workerEnv);
  }

  if (url.pathname === "/runtime/operator/session" && request.method === "DELETE") {
    const { clearOperatorSession } = await import("./operator-read-auth");
    return clearOperatorSession();
  }

  if (url.pathname !== "/runtime/operator/week" || request.method !== "GET") return undefined;

  const authorization = await authorizeOperatorSession(request, workerEnv);
  if (authorization) return authorization;

  try {
    const environment = buildEnvironment(workerEnv);
    const resolution = resolveAirtableConfig(environment);
    if (resolution.status !== "CONFIGURED") {
      return Response.json({ ok: false, error: `Airtable connector not configured (missing: ${resolution.missing.join(", ")})` }, { status: 503 });
    }

    const now = new Date();
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 30);
    const replayClock = now.toISOString();

    const source = createAirtableRestRowSource({
      config: resolution.config,
      fetchImpl: fetch as unknown as FetchLike,
      provenance: `airtable read-only GET ${resolution.config.baseId}/${resolution.config.eventsTable}`,
    });
    const port = createEvidenceAwareAirtableProductionPort({
      source,
      mode: "PRODUCTION_READ_ONLY",
      portId: "airtable-production-household-events",
    });
    const loaded = await loadProductionState(port, {
      mode: "PRODUCTION_READ_ONLY",
      datasetId: "FoodOS Production HOUSEHOLD EVENTS",
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
    if (!loaded.ok) {
      return Response.json({ ok: false, mode: "PRODUCTION_READ_ONLY", sourceId: loaded.sourceId, rejections: loaded.rejections }, { status: 502 });
    }

    const snapshot = replayEvents(loaded.openingEvents, { now: () => replayClock });
    const handoff = toQuantityRequirementsHandoff(snapshot);

    const [mealRows, quantityRows, preferenceRows] = await Promise.all([
      listTable(resolution.config, TABLES.mealPlans, MEAL_PLAN_FIELDS, { "sort[0][field]": "Date", "sort[0][direction]": "asc" }),
      listTable(resolution.config, TABLES.quantityRequirements, QUANTITY_FIELDS),
      listTable(resolution.config, TABLES.preferences, PREFERENCE_FIELDS, { filterByFormula: "{Active}=1" }),
    ]);

    const productionMealRows = mealRows
      .filter((record) => isProduction(field(record, "Record class")))
      .filter((record) => typeof field(record, "Date") === "string");
    const weekWindow = resolveCurrentWeekWindow(replayClock);
    const weekSelection = selectCurrentWeekRows(productionMealRows, weekWindow, (record) => field(record, "Date"));

    const meals = weekSelection.current
      .map((record) => ({
        id: record.id,
        meal: field(record, "Meal"),
        date: field(record, "Date"),
        mealType: selectName(field(record, "Meal type")),
        method: field(record, "Method"),
        why: field(record, "Why this meal"),
        leftovers: field(record, "Leftovers"),
      }));

    const mealIdSet = new Set(meals.map((meal) => meal.id).filter((id): id is string => typeof id === "string"));
    const quantities = quantityRows
      .filter((record) => linkedIds(field(record, "Meal")).some((id) => mealIdSet.has(id)))
      .filter((record) => typeof field(record, "Item") === "string" && typeof field(record, "Required quantity") === "number")
      .map((record) => ({
        id: record.id,
        mealIds: linkedIds(field(record, "Meal")),
        mealNames: linkedNames(field(record, "Meal")),
        itemKey: field(record, "Item"),
        quantity: field(record, "Required quantity"),
        unit: field(record, "Unit"),
        calculationStatus: selectName(field(record, "Calculation status")),
        snapshotId: field(record, "Household state snapshot ID"),
        reconciliationStatus: selectName(field(record, "State reconciliation status")),
      }));

    const preferences = preferenceRows
      .filter((record) => field(record, "Active") === true)
      .map((record) => ({
        id: record.id,
        preference: field(record, "Preference"),
        category: selectName(field(record, "Category")),
        importance: selectName(field(record, "Importance")),
        seasonal: field(record, "Seasonal") === true,
        evidence: field(record, "Evidence/source"),
      }));

    return Response.json({
      ok: true,
      mode: "PRODUCTION_READ_ONLY",
      replayClock,
      sourceId: loaded.sourceId,
      sourceEventCount: loaded.openingEvents.length,
      snapshot,
      quantityRequirementsHandoff: handoff,
      meals,
      quantities,
      preferences,
      provenance: {
        householdState: "Production HOUSEHOLD EVENTS via read-only Airtable replay",
        meals: "Production MEAL PLANS via read-only Airtable GET",
        quantities: "Production-linked QUANTITY REQUIREMENTS via read-only Airtable GET",
        preferences: "Active PREFERENCES via read-only Airtable GET",
      },
      productionMutation: false,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, mode: "PRODUCTION_READ_ONLY", error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
