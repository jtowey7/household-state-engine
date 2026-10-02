/**
 * Family food inventory + meal planning. Deliberately separate from the
 * old Food OS stack: no event sourcing, no Airtable, no approval
 * boundaries — a plain D1 table and a couple of routes for a household
 * of six to use from their phones.
 */
import { FAMILY_PAGE_HTML } from "./page";
import { tescoLinksFor } from "./tesco-catalogue";
import { categoriseItem, CATEGORY_ORDER, type Category } from "./categorise";

export type D1Result = { results: unknown[]; success: boolean; meta?: { changes?: number } };
export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: () => Promise<D1Result>;
  run: () => Promise<D1Result>;
};
export type D1DatabaseLike = { prepare: (sql: string) => D1Statement };

interface InventoryRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  location: string;
  status: string | null;
  notes: string | null;
  category: string | null;
  added_at: number;
  updated_at: number;
}

function rowToItem(row: Record<string, unknown>) {
  const r = row as unknown as InventoryRow;
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    location: r.location,
    status: r.status,
    notes: r.notes,
    category: r.category,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
  };
}

/** Supermarket-aisle order, then alphabetical within each aisle. Items
 * without a category yet (not backfilled) sort as "Other". */
function sortByCategoryThenName<T extends { category: string | null; name: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const rankA = CATEGORY_ORDER.indexOf((a.category as (typeof CATEGORY_ORDER)[number]) || "Other");
    const rankB = CATEGORY_ORDER.indexOf((b.category as (typeof CATEGORY_ORDER)[number]) || "Other");
    const safeRankA = rankA === -1 ? CATEGORY_ORDER.length : rankA;
    const safeRankB = rankB === -1 ? CATEGORY_ORDER.length : rankB;
    if (safeRankA !== safeRankB) return safeRankA - safeRankB;
    return a.name.localeCompare(b.name);
  });
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

const CATEGORIES_MARKER = "###CATEGORIES_JSON###";

/**
 * Classifies grocery item names into supermarket aisles via a single
 * small AI call — this is what actually understands that "egg
 * tagliatelle" is pasta and "onion chutney" is a jarred preserve, which
 * no fixed keyword list can do for a word it's never seen. Always
 * degrades to an empty map on any failure (missing key, network error,
 * timeout, malformed reply) rather than throwing — callers fall back to
 * the free keyword classifier when a name is missing from the result.
 */
async function classifyItemCategories(
  names: string[],
  anthropicApiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Map<string, Category>> {
  if (names.length === 0 || !anthropicApiKey) return new Map();

  const systemPrompt = [
    "You sort grocery item names into supermarket aisles for a home food inventory app.",
    `Choose exactly one of these categories for each item: ${CATEGORY_ORDER.join(", ")}.`,
    "Judge by what the product actually IS, not just the first word of its name — a pasta shape is Tins & packets even when named after a filling (e.g. \"egg tagliatelle\"), a chutney or pickle is Tins & packets even when fruit- or vegetable-flavoured (e.g. \"onion chutney\"), a juice is Drinks even when named after a fruit.",
    'Use "Other" only when nothing else genuinely fits — most items belong in one of the other eight.',
  ].join("\n");

  const userPrompt =
    `Classify each of these item names. As the VERY LAST thing in your reply with nothing after it, output a line that is exactly ${CATEGORIES_MARKER} followed on the next line by a raw JSON object (no markdown fences, no commentary) mapping each item name EXACTLY as given below (verbatim) to one category string from the list.\n\nItems:\n` +
    names.map((n) => `- ${n}`).join("\n");

  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return new Map();

    const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
    const rawText = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");

    const markerIndex = rawText.indexOf(CATEGORIES_MARKER);
    if (markerIndex === -1) return new Map();
    const jsonPart = rawText.slice(markerIndex + CATEGORIES_MARKER.length).trim();

    const parsed = JSON.parse(jsonPart) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();

    const validCategories: readonly string[] = CATEGORY_ORDER;
    const map = new Map<string, Category>();
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && validCategories.includes(value)) {
        map.set(normaliseName(name), value as Category);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Any current row already categorised under this exact name (case/whitespace
 * insensitive) — reused for free so repeat items (most real-world adds)
 * never trigger a second AI call. */
async function findCachedCategory(db: D1DatabaseLike, name: string): Promise<Category | null> {
  const result = await db.prepare("SELECT * FROM family_inventory WHERE category IS NOT NULL").all();
  const target = normaliseName(name);
  const match = (result.results as { name: string; category: string }[]).find((r) => normaliseName(r.name) === target);
  return (match?.category as Category | undefined) ?? null;
}

/** Resolves one item's category: reuse a cached match under the same name,
 * else ask AI (if configured), else fall back to the free keyword guess —
 * in that order, so the common case (a name already seen before) never
 * costs anything at all. */
async function resolveCategory(
  db: D1DatabaseLike,
  name: string,
  anthropicApiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Category> {
  const cached = await findCachedCategory(db, name);
  if (cached) return cached;
  const aiResult = await classifyItemCategories([name], anthropicApiKey, fetchImpl);
  const aiCategory = aiResult.get(normaliseName(name));
  if (aiCategory) return aiCategory;
  return categoriseItem(name);
}

function hasFamilyKey(request: Request, expectedKey: string | undefined): boolean {
  if (!expectedKey) return false;
  const headerKey = request.headers.get("x-family-key");
  if (headerKey === expectedKey) return true;
  const url = new URL(request.url);
  return url.searchParams.get("key") === expectedKey;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Serves the page itself. No key required to load the shell — the key only gates the data. */
export function familyPageResponse(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/family" && url.pathname !== "/family/") return undefined;
  if (request.method !== "GET") return undefined;
  return new Response(FAMILY_PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function familyInventoryApiResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
  anthropicApiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/family/api/inventory")) return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json({ ok: false, error: "Inventory database is not configured" }, { status: 503 });
  }

  try {
    if (url.pathname === "/family/api/inventory" && request.method === "GET") {
      const result = await db.prepare("SELECT * FROM family_inventory ORDER BY name").all();
      const items = result.results.map(rowToItem);

      // Lazy, one-time backfill for rows added before categorisation (or
      // before this AI pass) existed. Batches every uncategorised name
      // into a single classification call — far cheaper than one call
      // per row — and falls back to the free keyword guess for any name
      // AI didn't return (including when no key is configured at all).
      const uncategorised = items.filter((item) => !item.category);
      if (uncategorised.length > 0) {
        const aiMap = await classifyItemCategories(
          uncategorised.map((item) => item.name),
          anthropicApiKey,
          fetchImpl,
        );
        for (const item of uncategorised) {
          const category = aiMap.get(normaliseName(item.name)) ?? categoriseItem(item.name);
          await db.prepare("UPDATE family_inventory SET category = ? WHERE id = ?").bind(category, item.id).run();
          item.category = category;
        }
      }

      return Response.json({ ok: true, items: sortByCategoryThenName(items) });
    }

    if (url.pathname === "/family/api/inventory" && request.method === "POST") {
      const body = await readJsonBody(request);
      const name = typeof body["name"] === "string" ? (body["name"] as string).trim() : "";
      if (!name) return Response.json({ ok: false, error: "Item name is required" }, { status: 400 });
      const quantity = typeof body["quantity"] === "number" && Number.isFinite(body["quantity"]) ? (body["quantity"] as number) : null;
      const unit = typeof body["unit"] === "string" && (body["unit"] as string).trim() ? (body["unit"] as string).trim() : null;
      const location = typeof body["location"] === "string" && (body["location"] as string).trim() ? (body["location"] as string).trim() : "Unsorted";
      const notes = typeof body["notes"] === "string" && (body["notes"] as string).trim() ? (body["notes"] as string).trim() : null;
      const category = await resolveCategory(db, name, anthropicApiKey, fetchImpl);
      const id = `fam_${crypto.randomUUID()}`;
      const now = Date.now();
      await db
        .prepare(
          "INSERT INTO family_inventory (id, name, quantity, unit, location, status, notes, category, added_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
        )
        .bind(id, name, quantity, unit, location, notes, category, now, now)
        .run();
      return Response.json({ ok: true, id });
    }

    const itemMatch = url.pathname.match(/^\/family\/api\/inventory\/([^/]+)$/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]!);

      if (request.method === "PATCH") {
        const body = await readJsonBody(request);
        const sets: string[] = [];
        const values: unknown[] = [];
        if (typeof body["name"] === "string" && (body["name"] as string).trim()) {
          const newName = (body["name"] as string).trim();
          sets.push("name = ?");
          values.push(newName);
          sets.push("category = ?");
          values.push(await resolveCategory(db, newName, anthropicApiKey, fetchImpl));
        }
        if (body["quantity"] === null || typeof body["quantity"] === "number") {
          sets.push("quantity = ?");
          values.push(body["quantity"]);
        }
        if (body["unit"] === null || typeof body["unit"] === "string") {
          sets.push("unit = ?");
          values.push(body["unit"]);
        }
        if (typeof body["location"] === "string" && (body["location"] as string).trim()) {
          sets.push("location = ?");
          values.push((body["location"] as string).trim());
        }
        if (body["notes"] === null || typeof body["notes"] === "string") {
          sets.push("notes = ?");
          values.push(body["notes"]);
        }
        if (sets.length === 0) return Response.json({ ok: false, error: "No fields to update" }, { status: 400 });
        sets.push("updated_at = ?");
        values.push(Date.now());
        values.push(id);
        const result = await db.prepare(`UPDATE family_inventory SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
        if ((result.meta?.changes ?? 0) === 0) return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
        return Response.json({ ok: true });
      }

      if (request.method === "DELETE") {
        const result = await db.prepare("DELETE FROM family_inventory WHERE id = ?").bind(id).run();
        if ((result.meta?.changes ?? 0) === 0) return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
        return Response.json({ ok: true });
      }
    }

    return Response.json({ ok: false, error: "Unknown inventory endpoint" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

export interface ShoppingListEntry {
  item: string;
  quantity: string;
  directUrl: string | null;
  directProductName: string | null;
  directVerifiedOn: string | null;
  searchUrl: string;
}

const SHOPPING_LIST_MARKER = "###SHOPPING_LIST_JSON###";

function longDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * Splits the model's reply into the prose plan and a structured shopping
 * list, attaching real Tesco links to every entry. If the model didn't
 * emit a well-formed trailing JSON block, the plan text is still
 * returned as-is and the shopping list is simply empty — never a hard
 * failure over a formatting slip.
 */
export function extractShoppingList(rawText: string): { plan: string; shoppingList: ShoppingListEntry[] } {
  const markerIndex = rawText.indexOf(SHOPPING_LIST_MARKER);
  if (markerIndex === -1) return { plan: rawText, shoppingList: [] };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + SHOPPING_LIST_MARKER.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!Array.isArray(parsed)) return { plan, shoppingList: [] };
    const shoppingList: ShoppingListEntry[] = parsed
      .filter((entry): entry is { item: unknown; quantity: unknown } => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const item = typeof entry.item === "string" ? entry.item.trim() : "";
        const quantity = typeof entry.quantity === "string" ? entry.quantity.trim() : "";
        const links = tescoLinksFor(item || "item");
        return {
          item: item || "Unnamed item",
          quantity,
          directUrl: links.directUrl,
          directProductName: links.directProductName,
          directVerifiedOn: links.directVerifiedOn,
          searchUrl: links.searchUrl,
        };
      })
      .filter((entry) => entry.item !== "Unnamed item" || entry.quantity !== "");
    return { plan, shoppingList };
  } catch {
    return { plan, shoppingList: [] };
  }
}

export interface UsedItemEntry {
  id: string;
  name: string;
  unit: string | null;
  currentQuantity: number;
  suggestedRemove: number;
}

const USED_ITEMS_MARKER = "###USED_ITEMS_JSON###";

/**
 * Splits a trailing "what tonight's meal used" block off the model's
 * reply and resolves each entry against the live inventory by exact
 * name match, so the page can offer a one-tap "remove these" action.
 * Only items with a known numeric inventory quantity and a clean name
 * match produce a removable entry; anything ambiguous, unmatched, or
 * unquantified is silently dropped rather than guessed at — the
 * household can still always adjust it by hand with the +/- buttons.
 */
export function extractUsedItems(
  rawText: string,
  items: { id: string; name: string; quantity: number | null; unit: string | null }[],
): { plan: string; usedItems: UsedItemEntry[] } {
  const markerIndex = rawText.indexOf(USED_ITEMS_MARKER);
  if (markerIndex === -1) return { plan: rawText, usedItems: [] };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + USED_ITEMS_MARKER.length).trim();
  const byName = new Map(items.map((item) => [normaliseName(item.name), item]));

  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!Array.isArray(parsed)) return { plan, usedItems: [] };
    const usedItems: UsedItemEntry[] = parsed
      .filter((entry): entry is { item: unknown; quantity: unknown } => typeof entry === "object" && entry !== null)
      .map((entry): UsedItemEntry | null => {
        const name = typeof entry.item === "string" ? entry.item.trim() : "";
        const requested =
          typeof entry.quantity === "number" && Number.isFinite(entry.quantity) ? entry.quantity : null;
        const match = name ? byName.get(normaliseName(name)) : undefined;
        if (!match || requested === null || typeof match.quantity !== "number") return null;
        const suggestedRemove = Math.max(0, Math.min(requested, match.quantity));
        if (suggestedRemove <= 0) return null;
        return { id: match.id, name: match.name, unit: match.unit, currentQuantity: match.quantity, suggestedRemove };
      })
      .filter((entry): entry is UsedItemEntry => entry !== null);
    return { plan, usedItems };
  } catch {
    return { plan, usedItems: [] };
  }
}

export interface MealHorizon {
  /** How many consecutive days, starting today, the model judges this
   * inventory can still produce a genuine dinner for the household. */
  days: number;
  /** A short plain-English reason for that number. */
  reason: string;
}

const HORIZON_MARKER = "###HORIZON_JSON###";

/**
 * Splits the model's own judgment of "how many real dinners are left in
 * this inventory" off its reply. This replaces a fixed shopping-day
 * assumption — the model reasons about actual stock, not a calendar. As
 * with the other structured blocks, a missing or malformed marker simply
 * yields no horizon rather than a failure; the page just won't show the
 * countdown banner for that response.
 */
export function extractHorizon(rawText: string): { plan: string; horizon: MealHorizon | null } {
  const markerIndex = rawText.indexOf(HORIZON_MARKER);
  if (markerIndex === -1) return { plan: rawText, horizon: null };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + HORIZON_MARKER.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { plan, horizon: null };
    const obj = parsed as { days?: unknown; reason?: unknown };
    if (typeof obj.days !== "number" || !Number.isFinite(obj.days)) return { plan, horizon: null };
    const days = Math.max(0, Math.round(obj.days));
    const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
    return { plan, horizon: { days, reason } };
  } catch {
    return { plan, horizon: null };
  }
}

export interface ShoppingListItem extends ShoppingListEntry {
  id: string;
  status: "pending" | "arrived" | "cancelled";
}

interface ShoppingListRow {
  id: string;
  item: string;
  quantity: string | null;
  direct_url: string | null;
  direct_product_name: string | null;
  direct_verified_on: string | null;
  search_url: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

function rowToShoppingListItem(row: Record<string, unknown>): ShoppingListItem {
  const r = row as unknown as ShoppingListRow;
  return {
    id: r.id,
    item: r.item,
    quantity: r.quantity ?? "",
    directUrl: r.direct_url,
    directProductName: r.direct_product_name,
    directVerifiedOn: r.direct_verified_on,
    searchUrl: r.search_url,
    status: r.status as ShoppingListItem["status"],
  };
}

/**
 * Adds freshly-planned shopping list entries to the persistent store,
 * skipping anything that's already pending under the same name so
 * re-running "Plan the week" doesn't pile up duplicates.
 */
async function persistPendingShoppingListEntries(db: D1DatabaseLike, entries: ShoppingListEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const existing = await db.prepare("SELECT item FROM family_shopping_list WHERE status = 'pending'").all();
  const existingNames = new Set((existing.results as { item: string }[]).map((row) => normaliseName(row.item)));
  const now = Date.now();
  for (const entry of entries) {
    if (existingNames.has(normaliseName(entry.item))) continue;
    const id = `shop_${crypto.randomUUID()}`;
    await db
      .prepare(
        "INSERT INTO family_shopping_list (id, item, quantity, direct_url, direct_product_name, direct_verified_on, search_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .bind(id, entry.item, entry.quantity || null, entry.directUrl, entry.directProductName, entry.directVerifiedOn, entry.searchUrl, now)
      .run();
    existingNames.add(normaliseName(entry.item));
  }
}

async function listPendingShoppingListItems(db: D1DatabaseLike): Promise<ShoppingListItem[]> {
  const result = await db.prepare("SELECT * FROM family_shopping_list WHERE status = 'pending' ORDER BY created_at ASC").all();
  return result.results.map((row) => rowToShoppingListItem(row as Record<string, unknown>));
}

/**
 * A pending shopping-list item is resolved once the household either
 * confirms it arrived (which also writes it into the inventory, via a
 * separate POST to /family/api/inventory from the client) or decides
 * not to get it after all. Either way the row is kept, just marked —
 * never deleted — so there's a record of what happened to it.
 */
export async function familyShoppingListApiResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/family/api/shopping-list")) return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json({ ok: false, error: "Inventory database is not configured" }, { status: 503 });
  }

  try {
    if (url.pathname === "/family/api/shopping-list" && request.method === "GET") {
      return Response.json({ ok: true, items: await listPendingShoppingListItems(db) });
    }

    const itemMatch = url.pathname.match(/^\/family\/api\/shopping-list\/([^/]+)$/);
    if (itemMatch && request.method === "PATCH") {
      const id = decodeURIComponent(itemMatch[1]!);
      const body = await readJsonBody(request);
      const status = body["status"];
      if (status !== "arrived" && status !== "cancelled") {
        return Response.json({ ok: false, error: "status must be 'arrived' or 'cancelled'" }, { status: 400 });
      }
      const result = await db
        .prepare("UPDATE family_shopping_list SET status = ?, resolved_at = ? WHERE id = ?")
        .bind(status, Date.now(), id)
        .run();
      if ((result.meta?.changes ?? 0) === 0) return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Unknown shopping list endpoint" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function familyPlanMealResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
  anthropicApiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/plan-meal" || request.method !== "POST") return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json({ ok: false, error: "Inventory database is not configured" }, { status: 503 });
  }
  if (!anthropicApiKey) {
    return Response.json(
      { ok: false, error: "Meal planning is not configured (missing ANTHROPIC_API_KEY)" },
      { status: 503 },
    );
  }

  const body = await readJsonBody(request);
  const mode = body["mode"] === "week" ? "week" : "today";
  const extraNotes = typeof body["notes"] === "string" ? (body["notes"] as string).trim() : "";

  try {
    const result = await db.prepare("SELECT * FROM family_inventory ORDER BY name").all();
    const items = result.results.map(rowToItem);

    const inventoryText =
      items.length === 0
        ? "(inventory is empty)"
        : items
            .map((item) => {
              const qty = item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "some";
              const ageDays = Math.max(0, Math.round((Date.now() - item.addedAt) / 86_400_000));
              const statusPart = item.status ? ` — ${item.status}` : "";
              return `- ${item.name} — ${qty}${statusPart} — added ${ageDays}d ago`;
            })
            .join("\n");

    const now = new Date();
    const todayLabel = longDateLabel(now);

    const systemPrompt = [
      "You are a practical family meal-planning assistant for a household of six: two adults, a 16-year-old, two 14-year-olds and a 9-year-old. Appetites are normal-to-smaller, not large eaters. One member of the household is vegetarian and needs a vegetarian option at every meal — either the whole meal is vegetarian, or there is a simple vegetarian swap/addition alongside the meat version (e.g. a veggie sausage instead of the meat one), not a separate complicated dish.",
      "Priorities, in order:",
      '1. Use what is already in the house, especially items whose status is "Use soon" or "Running low" and items that have been sitting unused a long time (the household has food they genuinely forget they own — actively surface those rather than only picking obvious, recently-added things).',
      "2. Meals must be easy, family-friendly and realistic on a tired weeknight. Simple and well-loved (e.g. chicken nuggets, chips and beans) is a completely acceptable answer — do not over-engineer for \"healthy\" at the cost of being realistic.",
      "3. Never invent inventory that is not listed. If something is needed and not in stock, put it on the shopping list rather than assuming it is there.",
      "4. The household does not make unplanned or same-day shopping trips — shopping happens in planned batches, not spontaneously. A same-day meal suggestion must be buildable entirely from what is already in stock — never suggest buying, picking up, or popping out for anything for tonight, no matter how thin the stock is. If stock is genuinely limited, say so plainly (e.g. \"it's a lean night, but here's the best of what you've got\") and still give one realistic answer — do not propose an ingredient that isn't listed as being in the house.",
      "5. Every meal plan must work for the vegetarian member of the household as described above.",
      "6. Be concise and concrete — plain meal names and short reasons, not long prose.",
      '7. You will also be asked to judge how many consecutive days, starting today, this inventory can still produce a genuine, filling, family-acceptable dinner for all six. Be an honest, slightly conservative judge of what counts as a real meal — plain toast, condiments only, or a lone stock cube do not count, even though they are technically edible.',
    ].join("\n");

    const horizonInstruction =
      'Immediately after that, before any other structured block, output a line that is exactly ###HORIZON_JSON### followed on the next line by a raw JSON object (no markdown fences, no commentary) of the form {"days": number, "reason": string}. "days" is your honest, slightly conservative judgment of how many consecutive days starting today (today = day 1) this inventory can still produce a genuine, filling, family-acceptable dinner for all six — not just technically-edible scraps. If a suggested meal uses up the last of a key ingredient, do not count a later day that depends on it still being there. "reason" is a short plain-English reason for that number, under 15 words, e.g. "After Thursday there\'s no protein left, just rice and tinned tomatoes."';

    const shoppingListInstruction =
      "After that, give ONE combined shopping list of what needs to be bought to get the household back to a comfortable buffer of real dinners — only things not already sufficiently in stock. Size every quantity realistically for this exact household (2 adults, a 16-year-old, two 14-year-olds and a 9-year-old — six normal-to-smaller appetites, not large eaters) — not a generic family-of-six default, and not restaurant-style oversized packs. Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###SHOPPING_LIST_JSON### followed on the next line by that same shopping list as a raw JSON array (no markdown fences, no commentary) of objects {\"item\": string, \"quantity\": string}. \"item\" must be a short plain grocery search term (e.g. \"chicken breast\", \"tinned tomatoes\"), not a sentence. \"quantity\" must state the amount/pack size to buy for this household's needs (e.g. \"1kg\", \"2 packs of 4\"), not a vague word. Keep the day-by-day plan above that marker free of JSON.";

    const usedItemsInstruction =
      "Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###USED_ITEMS_JSON### followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {\"item\": string, \"quantity\": number}. \"item\" must be copied EXACTLY, verbatim, from the inventory list above (identical spelling/wording) — do not paraphrase or rename it. \"quantity\" is how much of that item this meal uses, as a plain number in the same unit already shown for it in the inventory list. Leave an item out of this list entirely if you can't give a specific numeric amount for it. Keep the meal description above that marker free of JSON.";

    const userPrompt =
      mode === "today"
        ? `Today is ${todayLabel}. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }Suggest ONE meal for tonight using ONLY what's in stock — never suggest buying or popping out for anything. If something has been sitting unused a while and would work, prefer it. Reply with: the meal name, a one-line reason, and a short list of the inventory items it uses. ${horizonInstruction} ${usedItemsInstruction}`
        : `Today is ${todayLabel}. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }First, judge how many consecutive days starting today (today = day 1) this inventory can still produce a genuine, filling, family-acceptable dinner for all six — not just technically-edible scraps. Then plan one dinner for each of those days, up to a maximum of 10 days — if your honest estimate is longer than 10, only write out dinners for the first 10, but still report your real, uncapped estimate in the HORIZON_JSON block below. Prioritise using up what's already in stock, especially anything that's been sitting unused a long time. For each day give a short meal name and what it uses from stock. ${horizonInstruction} ${shoppingListInstruction}`;

    let response: Response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        // Picking one meal (or a week of them) from a short given list is a
        // simple matching task, not deep reasoning — keep thinking effort
        // low so this stays fast; the model still requires an explicit
        // thinking mode on this model family.
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 2000,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        // Fail fast and visibly rather than let the family page hang with
        // no feedback if the API is ever slow.
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return Response.json(
        {
          ok: false,
          error: timedOut
            ? "Meal planning took too long and timed out — try again."
            : `Meal planning request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 504 },
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      return Response.json(
        { ok: false, error: `Meal planning request failed [${response.status}]: ${errText}` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as { content?: AnthropicTextBlock[] };
    const rawText = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    const { plan: planAfterShopping, shoppingList } = extractShoppingList(rawText);
    const { plan: planAfterUsed, usedItems } = extractUsedItems(planAfterShopping, items);
    const { plan, horizon } = extractHorizon(planAfterUsed);

    // Week-mode shopping lists persist until the household resolves them —
    // ordering today can mean a delivery days away, possibly checked from a
    // different device. Today mode never touches the shopping list.
    let persistedShoppingList: ShoppingListItem[] = [];
    if (mode === "week") {
      await persistPendingShoppingListEntries(db, shoppingList);
      persistedShoppingList = await listPendingShoppingListItems(db);
    }

    return Response.json({ ok: true, mode, plan, shoppingList: persistedShoppingList, usedItems, horizon });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
