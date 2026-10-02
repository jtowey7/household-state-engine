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
  /** The dinner this purchase would unlock, e.g. "Beef burgers" — null if
   * the model didn't attach one (degraded gracefully rather than dropped). */
  meal: string | null;
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
 * list, attaching real Tesco links to every entry. The model groups
 * entries by the dinner each purchase would unlock (rather than a flat
 * ingredient dump), which this flattens into one row per item while
 * keeping that meal label. If the model didn't emit a well-formed
 * trailing JSON block, the plan text is still returned as-is and the
 * shopping list is simply empty — never a hard failure over a
 * formatting slip.
 */
export function extractShoppingList(rawText: string): { plan: string; shoppingList: ShoppingListEntry[] } {
  const markerIndex = rawText.indexOf(SHOPPING_LIST_MARKER);
  if (markerIndex === -1) return { plan: rawText, shoppingList: [] };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + SHOPPING_LIST_MARKER.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!Array.isArray(parsed)) return { plan, shoppingList: [] };
    const shoppingList: ShoppingListEntry[] = [];
    for (const group of parsed) {
      if (typeof group !== "object" || group === null) continue;
      const g = group as { meal?: unknown; items?: unknown };
      const meal = typeof g.meal === "string" ? g.meal.trim() : "";
      const groupItems = Array.isArray(g.items) ? g.items : [];
      for (const entry of groupItems) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as { item?: unknown; quantity?: unknown };
        const item = typeof e.item === "string" ? e.item.trim() : "";
        const quantity = typeof e.quantity === "string" ? e.quantity.trim() : "";
        if (!item && !quantity) continue;
        const links = tescoLinksFor(item || "item");
        shoppingList.push({
          item: item || "Unnamed item",
          quantity,
          meal: meal || null,
          directUrl: links.directUrl,
          directProductName: links.directProductName,
          directVerifiedOn: links.directVerifiedOn,
          searchUrl: links.searchUrl,
        });
      }
    }
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

/**
 * Resolves a model-given list of {item, quantity} entries against the
 * live inventory by exact name match. Only items with a known numeric
 * inventory quantity and a clean name match produce a removable entry;
 * anything ambiguous, unmatched, or unquantified is silently dropped
 * rather than guessed at — the household can still always adjust it by
 * hand with the +/- buttons. Shared by every meal's own ingredient list.
 */
function resolveUsedItemEntries(
  rawEntries: unknown,
  items: { id: string; name: string; quantity: number | null; unit: string | null }[],
): UsedItemEntry[] {
  if (!Array.isArray(rawEntries)) return [];
  const byName = new Map(items.map((item) => [normaliseName(item.name), item]));
  return rawEntries
    .filter((entry): entry is { item: unknown; quantity: unknown } => typeof entry === "object" && entry !== null)
    .map((entry): UsedItemEntry | null => {
      const name = typeof entry.item === "string" ? entry.item.trim() : "";
      const requested = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) ? entry.quantity : null;
      const match = name ? byName.get(normaliseName(name)) : undefined;
      if (!match || requested === null || typeof match.quantity !== "number") return null;
      const suggestedRemove = Math.max(0, Math.min(requested, match.quantity));
      if (suggestedRemove <= 0) return null;
      return { id: match.id, name: match.name, unit: match.unit, currentQuantity: match.quantity, suggestedRemove };
    })
    .filter((entry): entry is UsedItemEntry => entry !== null);
}

export interface MealOption {
  name: string;
  reason: string;
  usedItems: UsedItemEntry[];
}

const MEALS_MARKER = "###MEALS_JSON###";

/**
 * Splits the model's list of ready-to-cook meals off its reply — every
 * genuine dinner buildable from stock right now, not a single prescribed
 * suggestion. Each meal resolves its own ingredients against the live
 * inventory, so the page can offer a one-tap "cooked it, remove these"
 * action per meal card. A missing or malformed block simply yields no
 * meals rather than a failure.
 */
export function extractMeals(
  rawText: string,
  items: { id: string; name: string; quantity: number | null; unit: string | null }[],
): { plan: string; meals: MealOption[] } {
  const markerIndex = rawText.indexOf(MEALS_MARKER);
  if (markerIndex === -1) return { plan: rawText, meals: [] };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + MEALS_MARKER.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!Array.isArray(parsed)) return { plan, meals: [] };
    const meals: MealOption[] = parsed
      .filter(
        (entry): entry is { name: unknown; reason: unknown; items: unknown } =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry): MealOption | null => {
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (!name) return null;
        const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
        const usedItems = resolveUsedItemEntries(entry.items, items);
        return { name, reason, usedItems };
      })
      .filter((entry): entry is MealOption => entry !== null);
    return { plan, meals };
  } catch {
    return { plan, meals: [] };
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
  meal: string | null;
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
    meal: r.meal ?? null,
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
 * re-running the planner doesn't pile up duplicates.
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
        "INSERT INTO family_shopping_list (id, item, quantity, meal, direct_url, direct_product_name, direct_verified_on, search_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .bind(
        id,
        entry.item,
        entry.quantity || null,
        entry.meal,
        entry.directUrl,
        entry.directProductName,
        entry.directVerifiedOn,
        entry.searchUrl,
        now,
      )
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

interface PixabaySearchResponse {
  hits?: { webformatURL?: string }[];
}

/**
 * Serves a representative photo for a meal name, via the free Pixabay
 * search API, cached by normalised name so repeat meals (the vast
 * majority of a family's weekly rotation) cost nothing after the first
 * lookup. Purely cosmetic — any failure (missing key, network error,
 * zero search results) degrades to a 404 rather than an error, so the
 * client can just hide the <img> and the meal card still works fine
 * without a picture. Auth accepts the family key as a query param (like
 * every other endpoint) since a plain <img src> can't carry a custom
 * header.
 */
export async function familyMealImageResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
  pixabayApiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/meal-image" || request.method !== "GET") return undefined;

  if (!hasFamilyKey(request, accessKey)) return new Response(null, { status: 401 });
  if (!db) return new Response(null, { status: 404 });

  const name = (url.searchParams.get("name") ?? "").trim();
  if (!name) return new Response(null, { status: 404 });
  const key = normaliseName(name);

  try {
    const cached = await db.prepare("SELECT image_url FROM meal_image_cache WHERE name_key = ?").bind(key).all();
    const cachedRow = cached.results[0] as { image_url: string | null } | undefined;
    if (cachedRow) {
      return cachedRow.image_url ? Response.redirect(cachedRow.image_url, 302) : new Response(null, { status: 404 });
    }

    if (!pixabayApiKey) return new Response(null, { status: 404 });

    let imageUrl: string | null;
    try {
      // Pixabay requires per_page between 3 and 200 (no single-result
      // option like Pexels had) — ask for the minimum and just take the
      // first hit.
      const searchResponse = await fetchImpl(
        `https://pixabay.com/api/?key=${encodeURIComponent(pixabayApiKey)}&q=${encodeURIComponent(name)}&image_type=photo&safesearch=true&per_page=3`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!searchResponse.ok) return new Response(null, { status: 404 });
      const payload = (await searchResponse.json()) as PixabaySearchResponse;
      imageUrl = payload.hits?.[0]?.webformatURL ?? null;
    } catch {
      // Network/timeout failure — serve a 404 without caching, so a
      // transient outage doesn't permanently poison the cache as "no image".
      return new Response(null, { status: 404 });
    }

    await db
      .prepare(
        "INSERT INTO meal_image_cache (name_key, image_url, fetched_at) VALUES (?, ?, ?) ON CONFLICT(name_key) DO UPDATE SET image_url = excluded.image_url, fetched_at = excluded.fetched_at",
      )
      .bind(key, imageUrl, Date.now())
      .run();

    return imageUrl ? Response.redirect(imageUrl, 302) : new Response(null, { status: 404 });
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 404 });
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
      "3. Never invent inventory that is not listed. If something is needed and not in stock, it belongs in the shopping list, not in a ready-now meal.",
      "4. The household does not make unplanned or same-day shopping trips. Every meal in the MEALS_JSON list must be fully buildable from what is already in stock right now, no matter how thin the stock is — never include one there that needs a purchase. A meal that needs something bought belongs in the shopping list instead, labelled with the meal it would unlock.",
      "5. Every meal plan must work for the vegetarian member of the household as described above.",
      "6. Be concise and concrete — plain meal names and short reasons, not long prose.",
      '7. A meal only belongs in MEALS_JSON if it is a genuine, filling, family-acceptable dinner — not just technically-edible scraps (plain toast, condiments only, a lone stock cube), even though those are technically edible. If stock truly cannot produce any such meal, MEALS_JSON may be empty — say so plainly in your opening line, and make the shopping list prioritise getting at least one proper meal back into reach.',
      "8. The MEALS_JSON block is mandatory whenever you say there are ready meals, with no exceptions — never name or describe individual meals only in prose and then omit them from the block. The opening line is a single short sentence with a count and nothing else — no meal names, no descriptions; every meal name and detail belongs solely in MEALS_JSON.",
    ].join("\n");

    const mealsInstruction =
      'List every genuine, family-acceptable dinner (see priority 7) that can be built entirely from what is already in stock right now — there is no fixed number, it could be one or several. Output ONLY a line that is exactly ###MEALS_JSON### followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {"name": string, "reason": string, "items": [{"item": string, "quantity": number}]}. "reason" is a one-line reason this meal works well now (e.g. uses up something going off). "items" lists what that one meal uses from the inventory above — "item" must be copied EXACTLY, verbatim, from the inventory list (identical spelling/wording), and "quantity" is a plain number in the same unit already shown for it there. Leave an item out of a meal\'s list if you can\'t give a specific numeric amount for it. This block is required even though you already gave a one-sentence count above — do not skip it, and do not describe meal names or details anywhere except inside it.';

    const shoppingListInstruction =
      'After that, suggest a small, focused shopping trip: enough to unlock roughly 2-4 further good meals beyond what\'s already buildable, capped at 12 items total even if that covers fewer meals — not an exhaustive restock. Group it by the meal each purchase would unlock. Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###SHOPPING_LIST_JSON### followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {"meal": string, "items": [{"item": string, "quantity": string}]}. "meal" is a short name for the dinner that group of items would complete. Each "item" must be a short plain grocery search term (e.g. "chicken breast", "tinned tomatoes"), not a sentence, and "quantity" must state the amount/pack size to buy for this household\'s needs (e.g. "1kg", "2 packs of 4"), not a vague word. Size everything realistically for this exact household (2 adults, a 16-year-old, two 14-year-olds and a 9-year-old — six normal-to-smaller appetites, not large eaters) — not a generic family-of-six default, and not restaurant-style oversized packs. Keep everything above the ###MEALS_JSON### marker free of JSON.';

    const userPrompt = `Today is ${todayLabel}. Here is everything currently in the house:\n\n${inventoryText}\n\n${
      extraNotes ? `Household note: ${extraNotes}\n\n` : ""
    }Open with exactly one short sentence stating how many genuine dinners this covers right now and, if it's a tight number, a brief why — do not name or describe any meal in this sentence. ${mealsInstruction} ${shoppingListInstruction}`;

    let response: Response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        // Listing every buildable meal from a short given inventory is a
        // simple matching task, not deep reasoning — keep thinking effort
        // low so this stays fast; the model still requires an explicit
        // thinking mode on this model family.
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 2500,
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
    const { plan, meals } = extractMeals(planAfterShopping, items);

    // Shopping-list suggestions persist until the household resolves
    // them — ordering today can mean a delivery days away, possibly
    // checked from a different device.
    await persistPendingShoppingListEntries(db, shoppingList);
    const persistedShoppingList = await listPendingShoppingListItems(db);

    return Response.json({ ok: true, plan, meals, shoppingList: persistedShoppingList });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
