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

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = [
      "You are a practical family meal-planning assistant for a household of six: two adults and four children.",
      "Priorities, in order:",
      '1. Use what is already in the house, especially items whose status is "Use soon" or "Running low", items that have been sitting a long time, and anything in "Freezer 2 (outside)" — that freezer is regularly forgotten about, so actively surface what is in it rather than ignoring it.',
      "2. Meals must be easy, family-friendly and realistic on a tired weeknight. Simple and well-loved (e.g. chicken nuggets, chips and beans) is a completely acceptable answer — do not over-engineer for \"healthy\" at the cost of being realistic.",
      "3. Never invent inventory that is not listed. If something is needed and not in stock, put it on the shopping list rather than assuming it is there.",
      "4. Be concise and concrete — plain meal names and short reasons, not long prose.",
    ].join("\n");

    const shoppingListInstruction =
      "After the day-by-day plan, give ONE combined shopping list of what needs to be bought to complete these meals — only things not already sufficiently in stock. Then, as the VERY LAST thing in your reply with nothing after it, output a line that is exactly ###SHOPPING_LIST_JSON### followed on the next line by that same shopping list as a raw JSON array (no markdown fences, no commentary) of objects {\"item\": string, \"quantity\": string}. \"item\" must be a short plain grocery search term (e.g. \"chicken breast\", \"tinned tomatoes\"), not a sentence. Keep the day-by-day plan above that marker free of JSON.";

    const userPrompt =
      mode === "today"
        ? `Today is ${today}. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }Suggest ONE meal for tonight using what's in stock. If something has been sitting a while or is in the easy-to-forget outside freezer and would work, prefer it. Reply with: the meal name, a one-line reason, and a short list of the inventory items it uses.`
        : `Today is ${today}. The household shops again on the coming Monday/Tuesday. Here is everything currently in the house:\n\n${inventoryText}\n\n${
            extraNotes ? `Household note: ${extraNotes}\n\n` : ""
          }Plan dinners from today until the next shopping trip (up to 7 days), prioritising using up what's already in stock — especially anything old or in the easy-to-forget outside freezer. For each day give a short meal name and what it uses from stock. ${shoppingListInstruction}`;

    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

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

    const { plan, shoppingList } = extractShoppingList(rawText);

    return Response.json({ ok: true, mode, plan, shoppingList });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
