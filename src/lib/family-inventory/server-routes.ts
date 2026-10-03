/**
 * Family food inventory + meal planning. Deliberately separate from the
 * old Food OS stack: no event sourcing, no Airtable, no approval
 * boundaries — a plain D1 table and a couple of routes for a household
 * of six to use from their phones.
 */
import { FAMILY_PAGE_HTML } from "./page";
import { tescoLinksFor } from "./tesco-catalogue";
import {
  categoriseItem,
  normaliseInventoryName,
  CATEGORY_ORDER,
  type Category,
} from "./categorise";

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
function sortByCategoryThenName<T extends { category: string | null; name: string }>(
  items: T[],
): T[] {
  return items.slice().sort((a, b) => {
    const rankA = CATEGORY_ORDER.indexOf(
      (a.category as (typeof CATEGORY_ORDER)[number]) || "Other",
    );
    const rankB = CATEGORY_ORDER.indexOf(
      (b.category as (typeof CATEGORY_ORDER)[number]) || "Other",
    );
    const safeRankA = rankA === -1 ? CATEGORY_ORDER.length : rankA;
    const safeRankB = rankB === -1 ? CATEGORY_ORDER.length : rankB;
    if (safeRankA !== safeRankB) return safeRankA - safeRankB;
    return a.name.localeCompare(b.name);
  });
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Parses a JSON value out of model output that's supposed to be raw JSON
 * but, despite the prompt saying "no markdown fences, no commentary",
 * sometimes arrives wrapped in a ```json ... ``` fence or with a stray
 * trailing sentence after it. Tries a direct parse first, then falls back
 * to the outermost matching bracket pair for the requested shape. Returns
 * null on anything that still doesn't parse — callers already treat a
 * missing/malformed block as "no result" rather than a hard failure, this
 * just widens what counts as a well-formed one so a cosmetic formatting
 * slip doesn't silently throw away a real answer.
 */
function extractJsonValue(text: string, shape: "array" | "object"): unknown {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fenced ? fenced[1]!.trim() : text;
  const [open, close] = shape === "array" ? ["[", "]"] : ["{", "}"];

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf(open);
    const end = unfenced.lastIndexOf(close);
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // Falls through to partial-array recovery below.
      }
    }
    // A response cut off mid-generation (hit the token budget) has an
    // array that never got its closing bracket — every attempt above
    // fails, and without this the ENTIRE array would be discarded even
    // when the model had fully written several complete entries before
    // running out of room. Salvage what's recoverable instead.
    if (shape === "array" && start !== -1) {
      const recovered = recoverTruncatedArray(unfenced.slice(start));
      if (recovered.length > 0) return recovered;
    }
    return undefined;
  }
}

/**
 * Recovers as many complete top-level objects as possible from a JSON
 * array string that may be truncated (no closing bracket, or a dangling
 * partial object at the end). Scans character-by-character tracking
 * brace depth and string/escape state so commas and braces inside string
 * values don't confuse the boundary detection, parsing each top-level
 * `{...}` independently and stopping at the first one that doesn't parse
 * cleanly — that's the truncated tail; everything genuinely complete
 * before it is kept.
 */
function recoverTruncatedArray(arrayText: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;
  for (let i = 1; i < arrayText.length; i++) {
    const ch = arrayText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        try {
          results.push(JSON.parse(arrayText.slice(objectStart, i + 1)));
        } catch {
          break;
        }
        objectStart = -1;
      }
    } else if (depth === 0 && ch === "]") {
      break;
    }
  }
  return results;
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
    'Judge by what the product actually IS, not just the first word of its name — a pasta shape is Tins & packets even when named after a filling (e.g. "egg tagliatelle"), a chutney or pickle is Tins & packets even when fruit- or vegetable-flavoured (e.g. "onion chutney"), a juice is Drinks even when named after a fruit.',
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

    const parsed = extractJsonValue(jsonPart, "object");
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
  const result = await db
    .prepare("SELECT * FROM family_inventory WHERE category IS NOT NULL")
    .all();
  const target = normaliseName(name);
  const match = (result.results as { name: string; category: string }[]).find(
    (r) => normaliseName(r.name) === target,
  );
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
  return new Response(FAMILY_PAGE_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
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
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  try {
    if (url.pathname === "/family/api/inventory" && request.method === "GET") {
      const result = await db.prepare("SELECT * FROM family_inventory ORDER BY name").all();
      const items = result.results.map(rowToItem);

      // Lazy, self-healing cleanup of brand-prefixed / size-suffixed names
      // ("Tesco Onions" -> "Onions"), same free-and-instant reasoning as
      // categoriseItem below — this runs on every load but is a no-op once
      // a name is already clean, so it only ever writes once per row.
      for (const item of items) {
        const cleaned = normaliseInventoryName(item.name);
        if (cleaned !== item.name) {
          await db
            .prepare("UPDATE family_inventory SET name = ? WHERE id = ?")
            .bind(cleaned, item.id)
            .run();
          item.name = cleaned;
        }
      }

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
          await db
            .prepare("UPDATE family_inventory SET category = ? WHERE id = ?")
            .bind(category, item.id)
            .run();
          item.category = category;
        }
      }

      return Response.json({ ok: true, items: sortByCategoryThenName(items) });
    }

    if (url.pathname === "/family/api/inventory" && request.method === "POST") {
      const body = await readJsonBody(request);
      const name = typeof body["name"] === "string" ? (body["name"] as string).trim() : "";
      if (!name)
        return Response.json({ ok: false, error: "Item name is required" }, { status: 400 });
      const quantity =
        typeof body["quantity"] === "number" && Number.isFinite(body["quantity"])
          ? (body["quantity"] as number)
          : null;
      const unit =
        typeof body["unit"] === "string" && (body["unit"] as string).trim()
          ? (body["unit"] as string).trim()
          : null;
      const location =
        typeof body["location"] === "string" && (body["location"] as string).trim()
          ? (body["location"] as string).trim()
          : "Unsorted";
      const notes =
        typeof body["notes"] === "string" && (body["notes"] as string).trim()
          ? (body["notes"] as string).trim()
          : null;
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
        if (sets.length === 0)
          return Response.json({ ok: false, error: "No fields to update" }, { status: 400 });
        sets.push("updated_at = ?");
        values.push(Date.now());
        values.push(id);
        const result = await db
          .prepare(`UPDATE family_inventory SET ${sets.join(", ")} WHERE id = ?`)
          .bind(...values)
          .run();
        if ((result.meta?.changes ?? 0) === 0)
          return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
        return Response.json({ ok: true });
      }

      if (request.method === "DELETE") {
        const result = await db.prepare("DELETE FROM family_inventory WHERE id = ?").bind(id).run();
        if ((result.meta?.changes ?? 0) === 0)
          return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
        return Response.json({ ok: true });
      }
    }

    return Response.json({ ok: false, error: "Unknown inventory endpoint" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
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

const ALMOST_MARKER = "###ALMOST_JSON###";

function longDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface AlmostMeal {
  name: string;
  reason: string;
  photoQuery: string;
  /** What's missing to make this meal buildable right now — plain grocery
   * terms and pack sizes, same shape the household already sees when
   * buying something. Resolved into real shopping-list rows (with Tesco
   * links) only once the household actively picks this meal to unlock,
   * not just because the model mentioned it. */
  missing: { item: string; quantity: string }[];
  /** True once the household has picked this meal to unlock — its missing
   * items are on the shopping list. Purely app-managed state: the model
   * never sets this, and a fresh plan-meal regeneration preserves an
   * already-unlocked meal (and this flag) rather than silently dropping it
   * just because this run's model output didn't happen to suggest it
   * again. Only an explicit dismiss removes it. */
  unlocked: boolean;
}

/**
 * Splits the model's reply into the prose plan and the list of "almost
 * there" meals — ones the household is one or two purchases away from
 * being able to cook, each tagged with exactly what's missing. This
 * replaces the old generic "shopping trip suggestion" block: rather than
 * silently queuing a dozen items on every plan request, the household
 * picks which near-miss meals they actually want to pursue, and only
 * those items get added to the shopping list. If the model didn't emit a
 * well-formed trailing JSON block, the plan text is still returned as-is
 * and the list is simply empty — never a hard failure over a formatting
 * slip.
 */
export function extractAlmostMeals(rawText: string): {
  plan: string;
  almostMeals: AlmostMeal[];
} {
  const markerIndex = rawText.indexOf(ALMOST_MARKER);
  if (markerIndex === -1) return { plan: rawText, almostMeals: [] };

  const plan = rawText.slice(0, markerIndex).trim();
  const jsonPart = rawText.slice(markerIndex + ALMOST_MARKER.length).trim();

  try {
    const parsed = extractJsonValue(jsonPart, "array");
    if (!Array.isArray(parsed)) return { plan, almostMeals: [] };
    const almostMeals: AlmostMeal[] = parsed
      .filter(
        (
          entry,
        ): entry is { name: unknown; reason: unknown; photoQuery: unknown; missing: unknown } =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry): AlmostMeal | null => {
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (!name) return null;
        const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
        const photoQuery =
          typeof entry.photoQuery === "string" && entry.photoQuery.trim()
            ? entry.photoQuery.trim()
            : name;
        const rawMissing = Array.isArray(entry.missing) ? entry.missing : [];
        const missing = rawMissing
          .filter(
            (m): m is { item: unknown; quantity: unknown } => typeof m === "object" && m !== null,
          )
          .map((m) => {
            const item = typeof m.item === "string" ? m.item.trim() : "";
            const quantity = typeof m.quantity === "string" ? m.quantity.trim() : "";
            return item ? { item, quantity } : null;
          })
          .filter((m): m is { item: string; quantity: string } => m !== null);
        if (missing.length === 0) return null;
        return { name, reason, photoQuery, missing, unlocked: false };
      })
      .filter((entry): entry is AlmostMeal => entry !== null);
    return { plan, almostMeals };
  } catch {
    return { plan, almostMeals: [] };
  }
}

/**
 * Merges a freshly-generated almost-meals list with whatever was unlocked
 * in the previous plan, so regenerating never silently drops a meal the
 * household already committed to (its missing items are already on the
 * shopping list). A fresh entry that matches an already-unlocked prior one
 * by name keeps the PRIOR record — not the fresh one — so the "missing"
 * list stays consistent with what was actually added to the shopping list,
 * rather than drifting if this run's model output phrased it slightly
 * differently. An unlocked meal the fresh list drops entirely is appended
 * rather than lost. Only an explicit dismiss ever removes an unlocked meal.
 */
function mergeAlmostMeals(fresh: AlmostMeal[], prior: AlmostMeal[]): AlmostMeal[] {
  const priorByKey = new Map(prior.map((meal) => [normaliseName(meal.name), meal]));
  const merged = fresh.map((freshMeal) => {
    const priorMatch = priorByKey.get(normaliseName(freshMeal.name));
    return priorMatch?.unlocked ? priorMatch : freshMeal;
  });
  const mergedKeys = new Set(merged.map((meal) => normaliseName(meal.name)));
  const droppedButUnlocked = prior.filter(
    (meal) => meal.unlocked && !mergedKeys.has(normaliseName(meal.name)),
  );
  return [...merged, ...droppedButUnlocked];
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
    .filter(
      (entry): entry is { item: unknown; quantity: unknown } =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry): UsedItemEntry | null => {
      const name = typeof entry.item === "string" ? entry.item.trim() : "";
      const requested =
        typeof entry.quantity === "number" && Number.isFinite(entry.quantity)
          ? entry.quantity
          : null;
      const match = name ? byName.get(normaliseName(name)) : undefined;
      if (!match || requested === null || typeof match.quantity !== "number") return null;
      const suggestedRemove = Math.max(0, Math.min(requested, match.quantity));
      if (suggestedRemove <= 0) return null;
      return {
        id: match.id,
        name: match.name,
        unit: match.unit,
        currentQuantity: match.quantity,
        suggestedRemove,
      };
    })
    .filter((entry): entry is UsedItemEntry => entry !== null);
}

export interface MealOption {
  name: string;
  reason: string;
  /** A short, generic dish name for the stock-photo lookup — deliberately
   * separate from the display `name`, which is often a compound household
   * description ("Chicken & bacon pies with mash and veg") that a photo
   * search matches poorly. Falls back to `name` when the model omits it. */
  photoQuery: string;
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
    const parsed = extractJsonValue(jsonPart, "array");
    if (!Array.isArray(parsed)) return { plan, meals: [] };
    const meals: MealOption[] = parsed
      .filter(
        (entry): entry is { name: unknown; reason: unknown; photoQuery: unknown; items: unknown } =>
          typeof entry === "object" && entry !== null,
      )
      .map((entry): MealOption | null => {
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (!name) return null;
        const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
        const photoQuery =
          typeof entry.photoQuery === "string" && entry.photoQuery.trim()
            ? entry.photoQuery.trim()
            : name;
        const usedItems = resolveUsedItemEntries(entry.items, items);
        return { name, reason, photoQuery, usedItems };
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
async function persistPendingShoppingListEntries(
  db: D1DatabaseLike,
  entries: ShoppingListEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const existing = await db
    .prepare("SELECT item FROM family_shopping_list WHERE status = 'pending'")
    .all();
  const existingNames = new Set(
    (existing.results as { item: string }[]).map((row) => normaliseName(row.item)),
  );
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
  const result = await db
    .prepare("SELECT * FROM family_shopping_list WHERE status = 'pending' ORDER BY created_at ASC")
    .all();
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
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  try {
    if (url.pathname === "/family/api/shopping-list" && request.method === "GET") {
      return Response.json({ ok: true, items: await listPendingShoppingListItems(db) });
    }

    // The household actively choosing to pursue an "almost there" meal
    // from the plan view — turns its missing items into real, Tesco-linked
    // shopping-list rows. Nothing lands here just because the model
    // mentioned it; only an explicit pick does.
    if (url.pathname === "/family/api/shopping-list/unlock" && request.method === "POST") {
      const body = await readJsonBody(request);
      const meal = typeof body["meal"] === "string" ? (body["meal"] as string).trim() : "";
      const rawItems = Array.isArray(body["items"]) ? body["items"] : [];
      const entries: ShoppingListEntry[] = rawItems
        .filter(
          (entry): entry is { item: unknown; quantity: unknown } =>
            typeof entry === "object" && entry !== null,
        )
        .map((entry): ShoppingListEntry | null => {
          const item = typeof entry.item === "string" ? entry.item.trim() : "";
          if (!item) return null;
          const quantity = typeof entry.quantity === "string" ? entry.quantity.trim() : "";
          const links = tescoLinksFor(item);
          return {
            item,
            quantity,
            meal: meal || null,
            directUrl: links.directUrl,
            directProductName: links.directProductName,
            directVerifiedOn: links.directVerifiedOn,
            searchUrl: links.searchUrl,
          };
        })
        .filter((entry): entry is ShoppingListEntry => entry !== null);
      if (entries.length === 0)
        return Response.json({ ok: false, error: "No items to add" }, { status: 400 });
      await persistPendingShoppingListEntries(db, entries);

      // Mark the matching almost-there meal unlocked in the shared plan, so
      // its card shows as "selected" rather than reverting to "not yet
      // chosen" — and so a future plan-meal regeneration knows to carry it
      // forward rather than silently dropping it.
      if (meal) {
        const stored = await getCurrentPlan(db);
        if (stored) {
          const key = normaliseName(meal);
          const matched = stored.almostMeals.some(
            (almostMeal) => normaliseName(almostMeal.name) === key,
          );
          if (matched) {
            await saveCurrentPlan(db, {
              ...stored,
              almostMeals: stored.almostMeals.map((almostMeal) =>
                normaliseName(almostMeal.name) === key
                  ? { ...almostMeal, unlocked: true }
                  : almostMeal,
              ),
            });
          }
        }
      }

      return Response.json({ ok: true, items: await listPendingShoppingListItems(db) });
    }

    const itemMatch = url.pathname.match(/^\/family\/api\/shopping-list\/([^/]+)$/);
    if (itemMatch && request.method === "PATCH") {
      const id = decodeURIComponent(itemMatch[1]!);
      const body = await readJsonBody(request);
      const status = body["status"];
      if (status !== "arrived" && status !== "cancelled") {
        return Response.json(
          { ok: false, error: "status must be 'arrived' or 'cancelled'" },
          { status: 400 },
        );
      }
      const result = await db
        .prepare("UPDATE family_shopping_list SET status = ?, resolved_at = ? WHERE id = ?")
        .bind(status, Date.now(), id)
        .run();
      if ((result.meta?.changes ?? 0) === 0)
        return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Unknown shopping list endpoint" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

interface PixabaySearchResponse {
  hits?: { webformatURL?: string; tags?: string }[];
}

// Pixabay's own "food" category still includes plenty of raw-ingredient and
// product photography (a bowl of whole peppers, a tub of beetroot paste) —
// category=food rules out animals/nature, but says nothing about whether a
// given food photo shows a finished, cooked dish versus the raw ingredients
// for one. Pixabay tags every photo with its own keywords, though, so rather
// than blindly taking the first hit, skip any whose own tags suggest it
// isn't a cooked dish before accepting one.
const UNAPPETISING_TAG_WORDS = [
  "raw",
  "fresh",
  "uncooked",
  "ingredient",
  "ingredients",
  "produce",
  "harvest",
  "market",
  "farm",
  "animal",
  "animals",
  "bird",
  "poultry",
  "livestock",
  "wildlife",
];

function looksCooked(tags: string | undefined): boolean {
  if (!tags) return true;
  const lowerTags = tags.toLowerCase();
  return !UNAPPETISING_TAG_WORDS.some((bad) => new RegExp(`\\b${bad}\\b`).test(lowerTags));
}

// A preference, not a requirement: plenty of good hits (a plain "pizza,
// cheese, tomato, italian" tagged photo) won't happen to use any of these
// words, so a hit lacking them is still acceptable — just not preferred
// over one that more explicitly signals a finished, plated meal.
const COOKED_DISH_HINT_WORDS = [
  "dinner",
  "meal",
  "dish",
  "plate",
  "plated",
  "cooked",
  "baked",
  "fried",
  "roasted",
  "grilled",
  "cuisine",
  "lunch",
  "takeaway",
];

function looksLikeFinishedDish(tags: string | undefined): boolean {
  if (!tags) return false;
  const lowerTags = tags.toLowerCase();
  return COOKED_DISH_HINT_WORDS.some((hint) => new RegExp(`\\b${hint}\\b`).test(lowerTags));
}

// A specific meal name occasionally gets zero Pixabay hits (unusual phrasing,
// a niche dish). Rather than show no photo at all, fall back to one of these
// generic-but-appetising searches so every card still gets *something* food-y.
// Picked deterministically per meal (see pickGenericFoodQuery) just for a bit
// of variety across different meals, not because it matters which one shows.
const GENERIC_FOOD_QUERIES = [
  "home cooked dinner",
  "family meal",
  "comfort food plate",
  "delicious home cooking",
];

function pickGenericFoodQuery(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return GENERIC_FOOD_QUERIES[Math.abs(hash) % GENERIC_FOOD_QUERIES.length] ?? "home cooked dinner";
}

/** Runs one Pixabay photo search, restricted to the food category, and
 * returns the first hit's URL (or null on zero results / a non-OK response).
 * Throws on network/timeout failure — callers decide how to degrade. */
async function searchPixabayPhoto(
  query: string,
  pixabayApiKey: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  // category=food restricts results to Pixabay's own "Food & Drink"
  // category, which structurally rules out hits from its "animals"/"nature"
  // categories (e.g. a live turkey for "turkey dinner") regardless of how
  // the query text is worded. But "food" still covers raw-ingredient and
  // product photography (a bowl of whole peppers, a tub of beetroot paste),
  // which the category restriction alone does nothing to prevent. Asking
  // for more than the bare minimum of hits gives looksCooked() something to
  // actually choose between, rather than blindly trusting whatever Pixabay
  // ranks first.
  const searchResponse = await fetchImpl(
    `https://pixabay.com/api/?key=${encodeURIComponent(pixabayApiKey)}&q=${encodeURIComponent(query)}&image_type=photo&category=food&order=popular&safesearch=true&per_page=15`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!searchResponse.ok) throw new Error(`Pixabay search failed: ${searchResponse.status}`);
  const payload = (await searchResponse.json()) as PixabaySearchResponse;
  const hits = payload.hits ?? [];
  // Among hits that don't look raw/uncooked/animal, prefer one whose tags
  // also explicitly signal a finished, plated meal — but don't require it,
  // since plenty of perfectly good photos just won't happen to use one of
  // these words. Only a hit where every candidate looked unappetising
  // falls all the way back to the top-ranked one regardless.
  const acceptableHits = hits.filter((hit) => looksCooked(hit.tags));
  const bestHit =
    acceptableHits.find((hit) => looksLikeFinishedDish(hit.tags)) ?? acceptableHits[0] ?? hits[0];
  return bestHit?.webformatURL ?? null;
}

/**
 * Serves a representative photo for a meal name, via the free Pixabay
 * search API, cached by normalised name so repeat meals (the vast
 * majority of a family's weekly rotation) cost nothing after the first
 * lookup. A meal name that gets zero hits falls back to a generic
 * "food & drink" search so a card never ends up with no photo at all.
 * Purely cosmetic — any failure (missing key, network error) degrades to
 * a 404 rather than an error, so the client can just hide the <img> and
 * the meal card still works fine without a picture. Auth accepts the
 * family key as a query param (like every other endpoint) since a plain
 * <img src> can't carry a custom header.
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
    const cached = await db
      .prepare("SELECT image_url FROM meal_image_cache WHERE name_key = ?")
      .bind(key)
      .all();
    const cachedRow = cached.results[0] as { image_url: string | null } | undefined;
    if (cachedRow) {
      return cachedRow.image_url
        ? Response.redirect(cachedRow.image_url, 302)
        : new Response(null, { status: 404 });
    }

    if (!pixabayApiKey) return new Response(null, { status: 404 });

    // The specific meal's own search and the generic fallback search are
    // tried independently — a failure (network error, non-OK response) on
    // the specific one must still fall through to the generic one rather
    // than giving up immediately, otherwise the one case the fallback
    // exists for (the specific search having trouble) is exactly the case
    // where it never gets a chance to run.
    let imageUrl: string | null;
    try {
      imageUrl = await searchPixabayPhoto(name, pixabayApiKey, fetchImpl);
    } catch {
      imageUrl = null;
    }
    if (!imageUrl) {
      try {
        imageUrl = await searchPixabayPhoto(pickGenericFoodQuery(key), pixabayApiKey, fetchImpl);
      } catch {
        // Both searches failed outright (not just zero hits) — a genuine
        // transient outage, so serve a 404 without caching rather than
        // poisoning the cache as "no image" for what could just be a blip.
        return new Response(null, { status: 404 });
      }
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

export interface FamilyPreferences {
  peopleCount: number;
  dietaryNotes: string | null;
  spiceLevel: string | null;
}

interface FamilyPreferencesRow {
  people_count: number;
  dietary_notes: string | null;
  spice_level: string | null;
}

/** Standing household defaults baked into every meal-planning prompt as the
 * baseline — household size, dietary constraints, spice preference — so
 * nobody has to retype them every time. A single shared row, since the
 * whole point is every phone in the house sees the same defaults. Falls
 * back to a sensible default if the seed row is ever missing. */
async function getFamilyPreferences(db: D1DatabaseLike): Promise<FamilyPreferences> {
  const result = await db.prepare("SELECT * FROM family_preferences WHERE id = 'default'").all();
  const row = result.results[0] as unknown as FamilyPreferencesRow | undefined;
  return {
    peopleCount: row?.people_count ?? 6,
    dietaryNotes: row?.dietary_notes ?? null,
    spiceLevel: row?.spice_level ?? null,
  };
}

export async function familyPreferencesApiResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/preferences") return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  try {
    if (request.method === "GET") {
      return Response.json({ ok: true, ...(await getFamilyPreferences(db)) });
    }

    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      const sets: string[] = [];
      const values: unknown[] = [];
      if (
        typeof body["peopleCount"] === "number" &&
        Number.isFinite(body["peopleCount"]) &&
        body["peopleCount"] > 0
      ) {
        sets.push("people_count = ?");
        values.push(Math.round(body["peopleCount"] as number));
      }
      if (body["dietaryNotes"] === null || typeof body["dietaryNotes"] === "string") {
        sets.push("dietary_notes = ?");
        const trimmed =
          typeof body["dietaryNotes"] === "string" ? (body["dietaryNotes"] as string).trim() : null;
        values.push(trimmed || null);
      }
      if (body["spiceLevel"] === null || typeof body["spiceLevel"] === "string") {
        sets.push("spice_level = ?");
        const trimmed =
          typeof body["spiceLevel"] === "string" ? (body["spiceLevel"] as string).trim() : null;
        values.push(trimmed || null);
      }
      if (sets.length === 0)
        return Response.json({ ok: false, error: "No fields to update" }, { status: 400 });
      sets.push("updated_at = ?");
      values.push(Date.now());
      await db
        .prepare(`UPDATE family_preferences SET ${sets.join(", ")} WHERE id = 'default'`)
        .bind(...values)
        .run();
      return Response.json({ ok: true, ...(await getFamilyPreferences(db)) });
    }

    return Response.json({ ok: false, error: "Unknown preferences endpoint" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export interface StoredPlan {
  plan: string;
  meals: MealOption[];
  almostMeals: AlmostMeal[];
  generatedAt: number;
}

interface CurrentPlanRow {
  plan_text: string | null;
  meals_json: string;
  almost_json: string;
  generated_at: number;
}

/** The most recently generated meal plan, shared across every phone in the
 * house (same pattern as family_preferences) so reloading — or opening the
 * app on a different device — shows the same ready/almost meals rather
 * than losing the plan or silently regenerating a different one. */
async function getCurrentPlan(db: D1DatabaseLike): Promise<StoredPlan | null> {
  const result = await db
    .prepare(
      "SELECT plan_text, meals_json, almost_json, generated_at FROM family_current_plan WHERE id = 'default'",
    )
    .all();
  const row = result.results[0] as unknown as CurrentPlanRow | undefined;
  if (!row) return null;
  return {
    plan: row.plan_text ?? "",
    meals: JSON.parse(row.meals_json) as MealOption[],
    almostMeals: JSON.parse(row.almost_json) as AlmostMeal[],
    generatedAt: row.generated_at,
  };
}

async function saveCurrentPlan(db: D1DatabaseLike, plan: StoredPlan): Promise<void> {
  await db
    .prepare(
      "INSERT INTO family_current_plan (id, plan_text, meals_json, almost_json, generated_at) VALUES ('default', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET plan_text = excluded.plan_text, meals_json = excluded.meals_json, almost_json = excluded.almost_json, generated_at = excluded.generated_at",
    )
    .bind(plan.plan, JSON.stringify(plan.meals), JSON.stringify(plan.almostMeals), plan.generatedAt)
    .run();
}

export async function familyPlanMealResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
  anthropicApiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/plan-meal") return undefined;
  if (request.method !== "GET" && request.method !== "POST") return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  if (request.method === "GET") {
    const stored = await getCurrentPlan(db);
    return Response.json({
      ok: true,
      plan: stored?.plan ?? "",
      meals: stored?.meals ?? [],
      almostMeals: stored?.almostMeals ?? [],
      generatedAt: stored?.generatedAt ?? null,
    });
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
    const preferences = await getFamilyPreferences(db);
    const result = await db.prepare("SELECT * FROM family_inventory ORDER BY name").all();
    const items = result.results.map(rowToItem);

    const inventoryText =
      items.length === 0
        ? "(inventory is empty)"
        : items
            .map((item) => {
              const qty =
                item.quantity != null
                  ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
                  : "some";
              const ageDays = Math.max(0, Math.round((Date.now() - item.addedAt) / 86_400_000));
              const statusPart = item.status ? ` — ${item.status}` : "";
              return `- ${item.name} — ${qty}${statusPart} — added ${ageDays}d ago`;
            })
            .join("\n");

    const now = new Date();
    const todayLabel = longDateLabel(now);

    const systemPrompt = [
      `You are a practical family meal-planning assistant for a household of ${preferences.peopleCount}. Appetites are normal-to-smaller, not large eaters. One member of the household is vegetarian and needs a vegetarian option at every meal — either the whole meal is vegetarian, or there is a simple vegetarian swap/addition alongside the meat version (e.g. a veggie sausage instead of the meat one), not a separate complicated dish.`,
      preferences.dietaryNotes
        ? `Household dietary constraints to respect at all times, in every meal: ${preferences.dietaryNotes}.`
        : null,
      preferences.spiceLevel ? `Household spice preference: ${preferences.spiceLevel}.` : null,
      "Priorities, in order:",
      '1. Use what is already in the house, especially items whose status is "Use soon" or "Running low" and items that have been sitting unused a long time (the household has food they genuinely forget they own — actively surface those rather than only picking obvious, recently-added things).',
      '2. Meals must be easy, family-friendly and realistic on a tired weeknight. Simple and well-loved (e.g. chicken nuggets, chips and beans) is a completely acceptable answer — do not over-engineer for "healthy" at the cost of being realistic.',
      "3. Never invent inventory that is not listed. If something is needed and not in stock, it belongs in ALMOST_JSON (see below), not in a ready-now meal.",
      "4. The household does not make unplanned or same-day shopping trips. Every meal in the MEALS_JSON list must be fully buildable from what is already in stock right now, no matter how thin the stock is — never include one there that needs a purchase. A meal that's only one or two purchases away belongs in ALMOST_JSON instead, labelled with exactly what's missing.",
      "5. Every meal plan must work for the vegetarian member of the household as described above.",
      "6. Be concise and concrete — plain meal names and short reasons, not long prose.",
      "7. A meal only belongs in MEALS_JSON if it is a genuine, filling, family-acceptable dinner — not just technically-edible scraps (plain toast, condiments only, a lone stock cube), even though those are technically edible. Combining several separate stock items into a meal (a protein + a carb + a vegetable/side, or a frozen ready meal + a side) is completely normal and exactly what most real dinners are — actively look for these combinations rather than only counting single ready-made dishes as valid, and don't hold back a genuinely workable combination just because no single inventory line already matches a named recipe. MEALS_JSON may legitimately be empty if stock truly cannot produce any such meal — that is a normal, expected outcome, not an error, but with a well-stocked house it should be rare.",
      "8. The MEALS_JSON block is mandatory and is the ONLY place meal names, descriptions or counts may appear. Never name, describe, count, or imply the existence of a meal in prose — the household's own app reads the count directly from MEALS_JSON and shows it, so stating a number in prose is redundant and risks contradicting the actual list if you forget to also add it there.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const mealsInstruction =
      'List every genuine, family-acceptable dinner (see priority 7) that can be built entirely from what is already in stock right now — there is no fixed number, it could be zero, one, or several. Output ONLY a line that is exactly ###MEALS_JSON### followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {"name": string, "reason": string, "photoQuery": string, "items": [{"item": string, "quantity": number}]}. "reason" is a one-line reason this meal works well now (e.g. uses up something going off). "photoQuery" is a short (2-4 word) GENERIC dish name for a stock-photo search — unlike "name", which can be a full household description ("Steak and gravy pie with mash and broccoli"), "photoQuery" must be the core cooked dish ABSTRACTED to the most common, recognisable umbrella term a stock-photo site will reliably have — the way a person glancing at the plate would name it, not the exact recipe. Drop specific sides/vegetables/sauces that aren\'t the defining feature: "Steak and gravy pie with mash and broccoli" becomes "pie and mash", not "steak and gravy pie with mash and broccoli"; "Cheese and tomato pizza" becomes just "pizza"; "Chicken and bacon pies with mash and peas" becomes "pie and mash". Never a raw ingredient name alone that could just as easily return a photo of the living animal or plant instead of the cooked food (e.g. "roast turkey dinner", not bare "turkey"; "roast chicken dinner", not bare "chicken"). "items" lists what that one meal uses from the inventory above — "item" must be copied EXACTLY, verbatim, from the inventory list (identical spelling/wording), and "quantity" is a plain number in the same unit already shown for it there. Leave an item out of a meal\'s list if you can\'t give a specific numeric amount for it. This block is mandatory — never skip it, and never state any meal name, description or count anywhere except inside it.';

    const almostInstruction = `After that, list up to 8 "almost there" meals: genuine, family-acceptable dinners (same bar as MEALS_JSON) that are fully buildable except for a small number of missing items — the household's equivalent of "you have everything for this except one thing, go buy it and you can make it tonight or this week." Favour meals that need the fewest, cheapest, most ordinary missing items; skip anything that would need a long or expensive list, since that's not really "almost there". Even when MEALS_JSON already has several ready meals, still include at least 1-3 of these whenever the kitchen genuinely contains that many near-miss options — this list is also for planning next week's shopping, not just tonight, so a well-stocked house is exactly when there should be MORE of these to browse, not fewer. Only go below 1-3, or return none, if the stock truly can't get within a couple of items of that many additional genuine dinners. Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ${ALMOST_MARKER} followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {"name": string, "reason": string, "photoQuery": string, "missing": [{"item": string, "quantity": string}]}. "name", "reason" and "photoQuery" follow the same rules as in MEALS_JSON. "missing" lists ONLY what needs to be bought (never something already in stock) — each "item" is a short plain grocery search term (e.g. "chicken breast", "tinned tomatoes"), not a sentence, and "quantity" states the amount/pack size to buy sized for this exact household of ${preferences.peopleCount} (e.g. "1kg", "2 packs of 4"), not a vague word or a restaurant-style oversized pack. Keep everything above the ${ALMOST_MARKER} marker free of JSON.`;

    const userPrompt = `Today is ${todayLabel}. Here is everything currently in the house:\n\n${inventoryText}\n\n${
      extraNotes
        ? `One-off note for this planning run only — if it conflicts with the household defaults above (e.g. a different headcount just for tonight), follow this instead for this run: ${extraNotes}\n\n`
        : ""
    }If there is genuinely useful context to add — why stock is particularly tight, how the vegetarian need is covered, something going off that's worth prioritising — give exactly one short sentence of that. If there's nothing worth saying, leave this completely blank. Never state a count or number of meals here; the app shows that separately, directly from your MEALS_JSON list below. ${mealsInstruction} ${almostInstruction}`;

    let response: Response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        // This response leans on the model reliably emitting a mandatory
        // structured block alongside free text — low effort was observed in
        // production to sometimes drop the MEALS_JSON block while still
        // describing meals in prose, so this uses medium effort to make
        // that instruction-following more reliable, at a modest latency
        // cost. The model still requires an explicit thinking mode on this
        // model family.
        //
        // max_tokens was raised from 2500: with a well-stocked house (the
        // prompt has grown to include preferences, abstracted photoQuery
        // instructions with examples, and a minimum almost-meals count on
        // top of the inventory listing and MEALS_JSON/ALMOST_JSON blocks
        // themselves), adaptive thinking plus a long genuine reply could
        // exhaust the old budget before finishing — and extractMeals used
        // to discard the ENTIRE meals list on a truncated response, so a
        // cut-off reply looked identical to "stock genuinely can't make
        // anything" ("No genuine dinners...") even when the model had real
        // answers it just didn't finish writing. See also the partial-array
        // recovery in extractJsonValue, which now salvages whatever
        // complete entries were written before a cutoff as a second layer
        // of defence against the same failure mode.
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 6000,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        // Fail fast and visibly rather than let the family page hang with
        // no feedback if the API is ever slow. Raised alongside max_tokens
        // so a longer, legitimate generation isn't itself cut off by the
        // client-side timeout.
        signal: AbortSignal.timeout(35_000),
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

    const { plan: planAfterAlmost, almostMeals: freshAlmostMeals } = extractAlmostMeals(rawText);
    const { plan, meals } = extractMeals(planAfterAlmost, items);

    // Nothing is persisted to the shopping list here — unlike the old
    // flat suggestion list, these are a browsable menu of near-miss
    // meals, not a commitment. A row only lands on the shopping list
    // once the household actively picks one to unlock, via the separate
    // /family/api/shopping-list/unlock endpoint.
    //
    // The plan itself IS persisted (shared across the house, like
    // preferences) so reloading the page or opening it on another phone
    // shows this same plan rather than losing it or silently regenerating
    // a different one from the same stock. Regenerating never silently
    // drops an already-unlocked almost-meal — see mergeAlmostMeals.
    const priorPlan = await getCurrentPlan(db);
    const almostMeals = mergeAlmostMeals(freshAlmostMeals, priorPlan?.almostMeals ?? []);

    const generatedAt = Date.now();
    await saveCurrentPlan(db, { plan, meals, almostMeals, generatedAt });

    return Response.json({ ok: true, plan, meals, almostMeals, generatedAt });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

/**
 * Marks one meal from the current shared plan as cooked: decrements each
 * used item against its LIVE inventory quantity (not a value captured back
 * when the plan was generated, which could now be stale — especially once
 * a plan can sit around for hours across a shared household) and removes
 * that meal from the persisted plan, so it won't still show a "cooked it"
 * button after a reload or on another phone. Identifies the meal by name
 * rather than array position, since the shared plan can be edited from
 * multiple devices and a position can shift under a stale client.
 */
export async function familyPlanCookResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/plan-meal/cook" || request.method !== "POST") return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  try {
    const body = await readJsonBody(request);
    const mealName =
      typeof body["mealName"] === "string" ? (body["mealName"] as string).trim() : "";
    if (!mealName) {
      return Response.json({ ok: false, error: "mealName is required" }, { status: 400 });
    }

    const stored = await getCurrentPlan(db);
    const key = normaliseName(mealName);
    const index = stored?.meals.findIndex((meal) => normaliseName(meal.name) === key) ?? -1;
    if (!stored || index === -1) {
      return Response.json(
        {
          ok: false,
          error:
            "That meal is no longer in the current plan — maybe it was already marked cooked from another device. Refresh to see the latest plan.",
        },
        { status: 404 },
      );
    }

    const meal = stored.meals[index]!;
    const now = Date.now();
    await Promise.all(
      meal.usedItems.map(async (entry) => {
        const current = await db
          .prepare("SELECT quantity FROM family_inventory WHERE id = ?")
          .bind(entry.id)
          .all();
        const row = current.results[0] as { quantity: number | null } | undefined;
        if (!row || typeof row.quantity !== "number") return;
        const next = Math.max(0, row.quantity - entry.suggestedRemove);
        await db
          .prepare("UPDATE family_inventory SET quantity = ?, updated_at = ? WHERE id = ?")
          .bind(next, now, entry.id)
          .run();
      }),
    );

    const remainingMeals = stored.meals.filter((_, i) => i !== index);
    await saveCurrentPlan(db, { ...stored, meals: remainingMeals });

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * Explicitly drops one meal from the current shared plan — a ready meal
 * decided against for a reason other than cooking it (takeaway instead),
 * or a locked/selected almost-meal the household no longer wants. This is
 * the ONLY way an unlocked almost-meal is ever removed: regenerating the
 * plan (familyPlanMealResponse) deliberately preserves it instead. For an
 * unlocked almost-meal, also cancels its pending shopping-list items —
 * without this, dismissing it would leave orphaned items on the shopping
 * list with no meal card left to explain them.
 */
export async function familyPlanDismissResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  accessKey: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/family/api/plan-meal/dismiss" || request.method !== "POST")
    return undefined;

  if (!hasFamilyKey(request, accessKey)) {
    return Response.json({ ok: false, error: "Missing or invalid family key" }, { status: 401 });
  }
  if (!db) {
    return Response.json(
      { ok: false, error: "Inventory database is not configured" },
      { status: 503 },
    );
  }

  try {
    const body = await readJsonBody(request);
    const mealName =
      typeof body["mealName"] === "string" ? (body["mealName"] as string).trim() : "";
    const kind = body["kind"];
    if (!mealName || (kind !== "ready" && kind !== "almost")) {
      return Response.json(
        { ok: false, error: "mealName and kind ('ready' or 'almost') are required" },
        { status: 400 },
      );
    }

    const stored = await getCurrentPlan(db);
    const key = normaliseName(mealName);
    const notFound = () =>
      Response.json(
        {
          ok: false,
          error:
            "That meal is no longer in the current plan — maybe it was already dismissed from another device. Refresh to see the latest plan.",
        },
        { status: 404 },
      );
    if (!stored) return notFound();

    if (kind === "ready") {
      const index = stored.meals.findIndex((meal) => normaliseName(meal.name) === key);
      if (index === -1) return notFound();
      const remainingMeals = stored.meals.filter((_, i) => i !== index);
      await saveCurrentPlan(db, { ...stored, meals: remainingMeals });
      return Response.json({ ok: true });
    }

    const index = stored.almostMeals.findIndex((meal) => normaliseName(meal.name) === key);
    if (index === -1) return notFound();
    const dismissed = stored.almostMeals[index]!;
    if (dismissed.unlocked) {
      await db
        .prepare(
          "UPDATE family_shopping_list SET status = 'cancelled', resolved_at = ? WHERE LOWER(meal) = LOWER(?) AND status = 'pending'",
        )
        .bind(Date.now(), mealName)
        .run();
    }
    const remainingAlmostMeals = stored.almostMeals.filter((_, i) => i !== index);
    await saveCurrentPlan(db, { ...stored, almostMeals: remainingAlmostMeals });

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
