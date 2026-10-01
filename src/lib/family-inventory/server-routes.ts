/**
 * Family food inventory + meal planning. Deliberately separate from the
 * old Food OS stack: no event sourcing, no Airtable, no approval
 * boundaries — a plain D1 table and a couple of routes for a household
 * of six to use from their phones.
 */
import { FAMILY_PAGE_HTML } from "./page";
import { tescoLinksFor } from "./tesco-catalogue";

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
    addedAt: r.added_at,
    updatedAt: r.updated_at,
  };
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
      const result = await db.prepare("SELECT * FROM family_inventory ORDER BY location, name").all();
      return Response.json({ ok: true, items: result.results.map(rowToItem) });
    }

    if (url.pathname === "/family/api/inventory" && request.method === "POST") {
      const body = await readJsonBody(request);
      const name = typeof body["name"] === "string" ? (body["name"] as string).trim() : "";
      if (!name) return Response.json({ ok: false, error: "Item name is required" }, { status: 400 });
      const quantity = typeof body["quantity"] === "number" && Number.isFinite(body["quantity"]) ? (body["quantity"] as number) : null;
      const unit = typeof body["unit"] === "string" && (body["unit"] as string).trim() ? (body["unit"] as string).trim() : null;
      const location = typeof body["location"] === "string" && (body["location"] as string).trim() ? (body["location"] as string).trim() : "Unsorted";
      const notes = typeof body["notes"] === "string" && (body["notes"] as string).trim() ? (body["notes"] as string).trim() : null;
      const id = `fam_${crypto.randomUUID()}`;
      const now = Date.now();
      await db
        .prepare(
          "INSERT INTO family_inventory (id, name, quantity, unit, location, status, notes, added_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
        )
        .bind(id, name, quantity, unit, location, notes, now, now)
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
          sets.push("name = ?");
          values.push((body["name"] as string).trim());
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

/** The household's fixed weekly shopping day. Change this one line if that ever moves. */
const SHOPPING_WEEKDAY = 1; // 1 = Monday (0 = Sunday ... 6 = Saturday)

/** The next occurrence of the shopping weekday strictly after `from` (so always 1-7 days out). */
export function nextShoppingDate(from: Date): Date {
  const result = new Date(from);
  result.setUTCHours(0, 0, 0, 0);
  do {
    result.setUTCDate(result.getUTCDate() + 1);
  } while (result.getUTCDay() !== SHOPPING_WEEKDAY);
  return result;
}

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

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

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
    const result = await db.prepare("SELECT * FROM family_inventory ORDER BY location, name").all();
    const items = result.results.map(rowToItem);

    const inventoryText =
      items.length === 0
        ? "(inventory is empty)"
        : items
            .map((item) => {
              const qty = item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "some";
              const ageDays = Math.max(0, Math.round((Date.now() - item.addedAt) / 86_400_000));
              const statusPart = item.status ? ` — ${item.status}` : "";
              return `- ${item.name} — ${qty} — ${item.location}${statusPart} — added ${ageDays}d ago`;
            })
            .join("\n");

    const now = new Date();
    const todayLabel = longDateLabel(now);
    const shopDate = nextShoppingDate(now);
    const shopLabel = longDateLabel(shopDate);
    const daysUntilShop = Math.round(
      (Date.UTC(shopDate.getUTCFullYear(), shopDate.getUTCMonth(), shopDate.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
        86_400_000,
    );

    const systemPrompt = [
      "You are a practical family meal-planning assistant for a household of six: two adults and four children.",
      "Priorities, in order:",
      '1. Use what is already in the house, especially items whose status is "Use soon" or "Running low", items that have been sitting a long time, and anything in "Freezer 2 (outside)" — that freezer is regularly forgotten about, so actively surface what is in it rather than ignoring it.',
      "2. Meals must be easy, family-friendly and realistic on a tired weeknight. Simple and well-loved (e.g. chicken nuggets, chips and beans) is a completely acceptable answer — do not over-engineer for \"healthy\" at the cost of being realistic.",
      "3. Never invent inventory that is not listed. If something is needed and not in stock, put it on the shopping list rather than assuming it is there.",
      "4. The household shops on a fixed weekly cadence (stated in the user message) and NEVER makes an unplanned trip. A same-day meal suggestion must be buildable entirely from what is already in stock — never suggest buying, picking up, or popping out for anything for tonight, no matter how thin the stock is. If stock is genuinely limited, say so plainly (e.g. \"it's a lean night, but here's the best of what you've got\") and still give one realistic answer — do not propose an ingredient that isn't listed as being in the house.",
      "5. Be concise and concrete — plain meal names and short reasons, not long prose.",
    ].join("\n");

    const shoppingListInstruction =
      "After the day-by-day plan, give ONE combined shopping list of what needs to be bought to complete these meals — only things not already sufficiently in stock. Note at the top of the shopping list that it's for the next shopping day, not before. Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###SHOPPING_LIST_JSON### followed on the next line by that same shopping list as a raw JSON array (no markdown fences, no commentary) of objects {\"item\": string, \"quantity\": string}. \"item\" must be a short plain grocery search term (e.g. \"chicken breast\", \"tinned tomatoes\"), not a sentence. Keep the day-by-day plan above that marker free of JSON.";

    const usedItemsInstruction =
      "Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###USED_ITEMS_JSON### followed on the next line by a raw JSON array (no markdown fences, no commentary) of objects {\"item\": string, \"quantity\": number}. \"item\" must be copied EXACTLY, verbatim, from the inventory list above (identical spelling/wording) — do not paraphrase or rename it. \"quantity\" is how much of that item this meal uses, as a plain number in the same unit already shown for it in the inventory list. Leave an item out of this list entirely if you can't give a specific numeric amount for it. Keep the meal description above that marker free of JSON.";

    const userPrompt =
      mode === "today"
        ? `Today is ${todayLabel}. The household's next shopping day is ${shopLabel} — today is not a shopping day, so do not suggest buying anything. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }Suggest ONE meal for tonight using ONLY what's in stock. If something has been sitting a while or is in the easy-to-forget outside freezer and would work, prefer it. Reply with: the meal name, a one-line reason, and a short list of the inventory items it uses. ${usedItemsInstruction}`
        : `Today is ${todayLabel}. The household's next shopping day is ${shopLabel}, which is ${daysUntilShop} day(s) away. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }Plan dinners for each of the ${daysUntilShop} day(s) from today up to and including the day before ${shopLabel}, prioritising using up what's already in stock — especially anything old or in the easy-to-forget outside freezer. For each day give a short meal name and what it uses from stock. ${shoppingListInstruction}`;

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
    const { plan, usedItems } = extractUsedItems(planAfterShopping, items);

    return Response.json({ ok: true, mode, plan, shoppingList, usedItems });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
