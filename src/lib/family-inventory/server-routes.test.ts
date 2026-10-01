import { describe, expect, it } from "vitest";
import {
  familyPageResponse,
  familyInventoryApiResponse,
  familyShoppingListApiResponse,
  familyPlanMealResponse,
  extractShoppingList,
  extractUsedItems,
  nextShoppingDate,
  type D1DatabaseLike,
} from "./server-routes";

const KEY = "test-family-key";

interface FakeRow {
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

interface FakeShoppingListRow {
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

function createFakeDb(
  initialRows: FakeRow[] = [],
  initialShoppingListRows: FakeShoppingListRow[] = [],
): { db: D1DatabaseLike; rows: () => FakeRow[]; shoppingListRows: () => FakeShoppingListRow[] } {
  let rows = [...initialRows];
  const shoppingListRows = [...initialShoppingListRows];
  const db: D1DatabaseLike = {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return statement;
        },
        async all() {
          if (sql.startsWith("SELECT * FROM family_inventory")) {
            const sorted = [...rows].sort((a, b) => (a.location + a.name).localeCompare(b.location + b.name));
            return { results: sorted as unknown[], success: true };
          }
          if (sql.startsWith("SELECT item FROM family_shopping_list WHERE status = 'pending'")) {
            return { results: shoppingListRows.filter((r) => r.status === "pending") as unknown[], success: true };
          }
          if (sql.startsWith("SELECT * FROM family_shopping_list WHERE status = 'pending'")) {
            const sorted = shoppingListRows.filter((r) => r.status === "pending").sort((a, b) => a.created_at - b.created_at);
            return { results: sorted as unknown[], success: true };
          }
          throw new Error(`Unhandled SELECT in fake db: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO family_inventory")) {
            const [id, name, quantity, unit, location, notes, addedAt, updatedAt] = boundArgs as [
              string,
              string,
              number | null,
              string | null,
              string,
              string | null,
              number,
              number,
            ];
            rows.push({
              id,
              name,
              quantity,
              unit,
              location,
              status: null,
              notes,
              added_at: addedAt,
              updated_at: updatedAt,
            });
            return { results: [], success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE family_inventory SET")) {
            const id = boundArgs[boundArgs.length - 1] as string;
            const row = rows.find((r) => r.id === id);
            if (!row) return { results: [], success: true, meta: { changes: 0 } };
            const setClause = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).trim();
            const cols = setClause.split(",").map((c) => c.trim().split("=")[0]!.trim());
            cols.forEach((col, i) => {
              (row as unknown as Record<string, unknown>)[col] = boundArgs[i];
            });
            return { results: [], success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM family_inventory")) {
            const id = boundArgs[0] as string;
            const before = rows.length;
            rows = rows.filter((r) => r.id !== id);
            return { results: [], success: true, meta: { changes: before - rows.length } };
          }
          if (sql.startsWith("INSERT INTO family_shopping_list")) {
            const [id, item, quantity, directUrl, directProductName, directVerifiedOn, searchUrl, createdAt] = boundArgs as [
              string,
              string,
              string | null,
              string | null,
              string | null,
              string | null,
              string,
              number,
            ];
            shoppingListRows.push({
              id,
              item,
              quantity,
              direct_url: directUrl,
              direct_product_name: directProductName,
              direct_verified_on: directVerifiedOn,
              search_url: searchUrl,
              status: "pending",
              created_at: createdAt,
              resolved_at: null,
            });
            return { results: [], success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE family_shopping_list SET")) {
            const [status, resolvedAt, id] = boundArgs as [string, number, string];
            const row = shoppingListRows.find((r) => r.id === id);
            if (!row) return { results: [], success: true, meta: { changes: 0 } };
            row.status = status;
            row.resolved_at = resolvedAt;
            return { results: [], success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unhandled statement in fake db: ${sql}`);
        },
      };
      return statement;
    },
  };
  return { db, rows: () => rows, shoppingListRows: () => shoppingListRows };
}

function req(path: string, init?: RequestInit & { key?: string }): Request {
  const url = new URL(path, "https://family.example");
  const headers = new Headers(init?.headers);
  if (init?.key !== undefined) headers.set("x-family-key", init.key);
  return new Request(url, { ...init, headers });
}

describe("familyPageResponse", () => {
  it("serves the page at /family with no key required", async () => {
    const response = familyPageResponse(req("/family"));
    expect(response).toBeDefined();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toContain("text/html");
    const body = await response!.text();
    expect(body).toContain("Our Food");
  });

  it("ignores unrelated paths", () => {
    expect(familyPageResponse(req("/family/api/inventory"))).toBeUndefined();
    expect(familyPageResponse(req("/other"))).toBeUndefined();
  });
});

describe("familyInventoryApiResponse — access control", () => {
  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(req("/family/api/inventory"), db, KEY);
    expect(response!.status).toBe(401);
  });

  it("accepts the key via query string as well as header", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req(`/family/api/inventory?key=${KEY}`),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
  });

  it("fails closed with 503 when the database binding is missing", async () => {
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { key: KEY }),
      undefined,
      KEY,
    );
    expect(response!.status).toBe(503);
  });
});

describe("familyInventoryApiResponse — CRUD", () => {
  it("lists items", async () => {
    const { db } = createFakeDb([
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, added_at: 1, updated_at: 1 },
    ]);
    const response = await familyInventoryApiResponse(req("/family/api/inventory", { key: KEY }), db, KEY);
    const body = (await response!.json()) as { ok: boolean; items: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: "a", name: "Milk", quantity: 2, location: "Fridge" });
  });

  it("refuses to add an item without a name", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ quantity: 1 }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });

  it("adds an item with defaults when location/unit are omitted", async () => {
    const { db, rows } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ name: "Pulled pork" }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ name: "Pulled pork", location: "Unsorted", quantity: null, unit: null });
  });

  it("updates an item's quantity and bumps updated_at", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, added_at: 1, updated_at: 1 },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory/a", { method: "PATCH", key: KEY, body: JSON.stringify({ quantity: 1 }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(rows()[0]!.quantity).toBe(1);
    expect(rows()[0]!.updated_at).toBeGreaterThan(1);
  });

  it("404s when updating an item that doesn't exist", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory/missing", { method: "PATCH", key: KEY, body: JSON.stringify({ quantity: 1 }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
  });

  it("removes an item", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, added_at: 1, updated_at: 1 },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory/a", { method: "DELETE", key: KEY }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(rows()).toHaveLength(0);
  });

  it("404s when deleting an item that doesn't exist", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory/missing", { method: "DELETE", key: KEY }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
  });
});

describe("familyShoppingListApiResponse", () => {
  it("ignores unrelated paths", async () => {
    const { db } = createFakeDb();
    expect(await familyShoppingListApiResponse(req("/family/api/inventory"), db, KEY)).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyShoppingListApiResponse(req("/family/api/shopping-list"), db, undefined);
    expect(response!.status).toBe(401);
  });

  it("503s when the database isn't configured", async () => {
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list", { key: KEY }),
      undefined,
      KEY,
    );
    expect(response!.status).toBe(503);
  });

  it("lists only pending items, oldest first", async () => {
    const { db } = createFakeDb([], [
      { id: "s1", item: "Beef mince", quantity: "750g", direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 200, resolved_at: null },
      { id: "s2", item: "Tinned tomatoes", quantity: "2 tins", direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=tomatoes", status: "pending", created_at: 100, resolved_at: null },
      { id: "s3", item: "Old thing", quantity: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=old", status: "arrived", created_at: 50, resolved_at: 60 },
    ]);
    const response = await familyShoppingListApiResponse(req("/family/api/shopping-list", { key: KEY }), db, KEY);
    const body = (await response!.json()) as { ok: boolean; items: { id: string; item: string }[] };
    expect(body.ok).toBe(true);
    expect(body.items.map((i) => i.id)).toEqual(["s2", "s1"]);
  });

  it("marks an item arrived", async () => {
    const { db, shoppingListRows } = createFakeDb([], [
      { id: "s1", item: "Beef mince", quantity: "750g", direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
    ]);
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", { method: "PATCH", key: KEY, body: JSON.stringify({ status: "arrived" }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(shoppingListRows()[0]!.status).toBe("arrived");
    expect(shoppingListRows()[0]!.resolved_at).not.toBeNull();

    const listResponse = await familyShoppingListApiResponse(req("/family/api/shopping-list", { key: KEY }), db, KEY);
    const body = (await listResponse!.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("marks an item cancelled", async () => {
    const { db, shoppingListRows } = createFakeDb([], [
      { id: "s1", item: "Beef mince", quantity: "750g", direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
    ]);
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", { method: "PATCH", key: KEY, body: JSON.stringify({ status: "cancelled" }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(shoppingListRows()[0]!.status).toBe("cancelled");
  });

  it("rejects an invalid status", async () => {
    const { db } = createFakeDb([], [
      { id: "s1", item: "Beef mince", quantity: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
    ]);
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", { method: "PATCH", key: KEY, body: JSON.stringify({ status: "bogus" }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });

  it("404s resolving an item that doesn't exist", async () => {
    const { db } = createFakeDb();
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/missing", { method: "PATCH", key: KEY, body: JSON.stringify({ status: "arrived" }) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
  });
});

describe("nextShoppingDate", () => {
  it("finds the next Monday from a midweek day", () => {
    const thursday = new Date(Date.UTC(2026, 9, 1)); // 2026-10-01 is a Thursday
    const result = nextShoppingDate(thursday);
    expect(result.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(result.getUTCDay()).toBe(1);
  });

  it("jumps a full week when today already is the shopping day", () => {
    const monday = new Date(Date.UTC(2026, 9, 5)); // 2026-10-05 is a Monday
    const result = nextShoppingDate(monday);
    expect(result.toISOString().slice(0, 10)).toBe("2026-10-12");
  });

  it("is always strictly in the future, never today", () => {
    const sunday = new Date(Date.UTC(2026, 9, 4)); // 2026-10-04 is a Sunday
    const result = nextShoppingDate(sunday);
    expect(result.toISOString().slice(0, 10)).toBe("2026-10-05");
  });
});

describe("extractShoppingList", () => {
  it("splits the prose plan from a well-formed trailing JSON block and attaches Tesco links", () => {
    const raw =
      'Day 1: spag bol.\n\n###SHOPPING_LIST_JSON###\n[{"item":"beef mince","quantity":"750g"},{"item":"dragon fruit","quantity":"2"}]';
    const { plan, shoppingList } = extractShoppingList(raw);
    expect(plan).toBe("Day 1: spag bol.");
    expect(shoppingList).toHaveLength(2);
    expect(shoppingList[0]).toMatchObject({ item: "beef mince", quantity: "750g" });
    expect(shoppingList[0]!.directUrl).toContain("tesco.com/shop/en-GB/products/");
    expect(shoppingList[1]!.directUrl).toBeNull();
    expect(shoppingList[1]!.searchUrl).toContain("tesco.com/shop/en-GB/search");
  });

  it("returns the whole text with an empty shopping list when there is no marker", () => {
    const { plan, shoppingList } = extractShoppingList("Just have pasta tonight.");
    expect(plan).toBe("Just have pasta tonight.");
    expect(shoppingList).toEqual([]);
  });

  it("degrades gracefully when the trailing block isn't valid JSON", () => {
    const { plan, shoppingList } = extractShoppingList("Day 1: tacos.\n\n###SHOPPING_LIST_JSON###\nnot json");
    expect(plan).toBe("Day 1: tacos.");
    expect(shoppingList).toEqual([]);
  });
});

describe("extractUsedItems", () => {
  const inventory = [
    { id: "a", name: "Beef mince", quantity: 500, unit: "g" },
    { id: "b", name: "Spaghetti", quantity: 1000, unit: "g" },
    { id: "c", name: "Garlic", quantity: null, unit: null },
  ];

  it("resolves exact-name matches with a known quantity against the live inventory", () => {
    const raw =
      'Spaghetti bolognese tonight.\n\n###USED_ITEMS_JSON###\n[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]';
    const { plan, usedItems } = extractUsedItems(raw, inventory);
    expect(plan).toBe("Spaghetti bolognese tonight.");
    expect(usedItems).toEqual([
      { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
      { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
    ]);
  });

  it("matches item names case-insensitively", () => {
    const raw = 'Tea.\n\n###USED_ITEMS_JSON###\n[{"item":"BEEF MINCE","quantity":100}]';
    const { usedItems } = extractUsedItems(raw, inventory);
    expect(usedItems).toEqual([{ id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 100 }]);
  });

  it("clamps a suggested removal to what's actually in stock rather than going negative", () => {
    const raw = 'Big dinner.\n\n###USED_ITEMS_JSON###\n[{"item":"Beef mince","quantity":9999}]';
    const { usedItems } = extractUsedItems(raw, inventory);
    expect(usedItems).toEqual([{ id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 500 }]);
  });

  it("drops items with no inventory match, no quantity in the model's reply, or no known stock quantity", () => {
    const raw =
      'Dinner.\n\n###USED_ITEMS_JSON###\n[{"item":"Garlic","quantity":1},{"item":"Beef mince","quantity":null},{"item":"Unicorn meat","quantity":1}]';
    const { usedItems } = extractUsedItems(raw, inventory);
    expect(usedItems).toEqual([]);
  });

  it("returns the whole text with no used items when there is no marker", () => {
    const { plan, usedItems } = extractUsedItems("Just pasta.", inventory);
    expect(plan).toBe("Just pasta.");
    expect(usedItems).toEqual([]);
  });

  it("degrades gracefully on invalid JSON", () => {
    const { plan, usedItems } = extractUsedItems("Tacos.\n\n###USED_ITEMS_JSON###\nnot json", inventory);
    expect(plan).toBe("Tacos.");
    expect(usedItems).toEqual([]);
  });
});

describe("familyPlanMealResponse", () => {
  it("ignores unrelated paths/methods", async () => {
    const { db } = createFakeDb();
    expect(await familyPlanMealResponse(req("/family/api/inventory"), db, KEY, "anthropic-key")).toBeUndefined();
    expect(
      await familyPlanMealResponse(req("/family/api/plan-meal", { method: "GET" }), db, KEY, "anthropic-key"),
    ).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", body: "{}" }),
      db,
      KEY,
      "anthropic-key",
    );
    expect(response!.status).toBe(401);
  });

  it("fails closed when ANTHROPIC_API_KEY is not configured", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      undefined,
    );
    expect(response!.status).toBe(503);
  });

  it("calls the Anthropic Messages API with the current inventory and returns the plan text", async () => {
    const { db } = createFakeDb([
      { id: "a", name: "Pulled pork", quantity: 500, unit: "g", location: "Freezer 2 (outside)", status: null, notes: null, added_at: 1, updated_at: 1 },
    ]);
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Pulled pork tacos tonight." }] }),
        { status: 200 },
      );
    };

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "today" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect((capturedInit!.headers as Record<string, string>)["x-api-key"]).toBe("anthropic-secret");
    const sentBody = JSON.parse(capturedInit!.body as string) as { model: string; messages: { content: string }[] };
    expect(sentBody.model).toBe("claude-sonnet-5");
    expect(sentBody.messages[0]!.content).toContain("Pulled pork");
    // Location is fully deprecated as a user-facing concept — it must never
    // reach the model, even though the column still exists in the database.
    const fullRequestBody = (capturedInit!.body as string).toLowerCase();
    expect(fullRequestBody).not.toContain("freezer");
    expect(fullRequestBody).not.toContain("location");

    const body = (await response!.json()) as { ok: boolean; plan: string };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Pulled pork tacos tonight.");
  });

  it("week mode asks for a shopping list and returns it with Tesco links attached", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: 'Mon: spag bol.\n\n###SHOPPING_LIST_JSON###\n[{"item":"beef mince","quantity":"750g"}]',
            },
          ],
        }),
        { status: 200 },
      );

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "week" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    const body = (await response!.json()) as {
      ok: boolean;
      plan: string;
      shoppingList: { id: string; item: string; directUrl: string | null; searchUrl: string; status: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Mon: spag bol.");
    expect(body.shoppingList).toHaveLength(1);
    expect(body.shoppingList[0]!.item).toBe("beef mince");
    expect(body.shoppingList[0]!.directUrl).toContain("tesco.com/shop/en-GB/products/");
    expect(body.shoppingList[0]!.status).toBe("pending");
    expect(body.shoppingList[0]!.id).toBeTruthy();
  });

  it("persists the shopping list so it survives past this one request, and doesn't duplicate an item still pending from an earlier plan", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: 'Mon: spag bol.\n\n###SHOPPING_LIST_JSON###\n[{"item":"beef mince","quantity":"750g"}]',
            },
          ],
        }),
        { status: 200 },
      );

    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "week" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(shoppingListRows()).toHaveLength(1);

    // Planning the week again before the first one arrives must not pile up
    // a second "beef mince" row — it's already pending.
    const secondResponse = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "week" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(shoppingListRows()).toHaveLength(1);
    const secondBody = (await secondResponse!.json()) as { shoppingList: { item: string }[] };
    expect(secondBody.shoppingList).toHaveLength(1);
  });

  it("today mode asks for used items and resolves them into a removable list with real inventory ids", async () => {
    const { db } = createFakeDb([
      { id: "a", name: "Beef mince", quantity: 500, unit: "g", location: "Freezer 2 (outside)", status: null, notes: null, added_at: 1, updated_at: 1 },
      { id: "b", name: "Spaghetti", quantity: 1000, unit: "g", location: "Cupboard", status: null, notes: null, added_at: 1, updated_at: 1 },
    ]);
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      sentContent = sentBody.messages[0]!.content;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                'Spaghetti bolognese.\n\n###USED_ITEMS_JSON###\n[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]',
            },
          ],
        }),
        { status: 200 },
      );
    };

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "today" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    expect(sentContent).toContain("###USED_ITEMS_JSON###");
    const body = (await response!.json()) as { ok: boolean; plan: string; usedItems: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Spaghetti bolognese.");
    expect(body.usedItems).toEqual([
      { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
      { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
    ]);
  });

  it("week mode does not ask the model for used items (no same-day removal applies)", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      sentContent = sentBody.messages[0]!.content;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Mon: pasta.\n\n###SHOPPING_LIST_JSON###\n[]" }] }),
        { status: 200 },
      );
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "week" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).not.toContain("USED_ITEMS_JSON");
  });

  it("today mode does not ask the model for a shopping list, and explicitly rules out a same-day shopping trip", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { system: string; messages: { content: string }[] };
      sentContent = sentBody.messages[0]!.content;
      sentSystem = sentBody.system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Pasta." }] }), { status: 200 });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "today" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).not.toContain("SHOPPING_LIST_JSON");
    expect(sentContent).toContain("today is not a shopping day, so do not suggest buying anything");
    expect(sentContent).toMatch(/next shopping day is/);
    expect(sentSystem).toMatch(/never suggest buying, picking up, or popping out/i);
  });

  it("week mode states the real next shopping date and how many days are being planned", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      sentContent = sentBody.messages[0]!.content;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Mon: pasta.\n\n###SHOPPING_LIST_JSON###\n[]" }] }),
        { status: 200 },
      );
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ mode: "week" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(/next shopping day is \w+, \d+ \w+ \d{4}, which is \d+ day\(s\) away/);
    expect(sentContent).toMatch(/Plan dinners for each of the \d+ day\(s\)/);
  });

  it("returns a clear error when the Anthropic API call fails", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () => new Response("boom", { status: 500 });
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(502);
    const body = (await response!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("500");
  });

  it("returns a clear, visible error on timeout rather than hanging", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    };
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(504);
    const body = (await response!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("timed out");
  });

  it("surfaces a plain network failure instead of silently failing", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(504);
    const body = (await response!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("network down");
  });

  it("sends low-effort adaptive thinking so meal planning stays fast", async () => {
    const { db } = createFakeDb();
    let sentBody: { thinking?: unknown; output_config?: unknown } = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Pasta." }] }), { status: 200 });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentBody.thinking).toEqual({ type: "adaptive" });
    expect(sentBody.output_config).toEqual({ effort: "low" });
  });
});
