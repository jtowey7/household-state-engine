import { describe, expect, it } from "vitest";
import {
  familyPageResponse,
  familyInventoryApiResponse,
  familyShoppingListApiResponse,
  familyPlanMealResponse,
  extractShoppingList,
  extractMeals,
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
  category: string | null;
  added_at: number;
  updated_at: number;
}

interface FakeShoppingListRow {
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
            const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
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
            const [id, name, quantity, unit, location, notes, category, addedAt, updatedAt] = boundArgs as [
              string,
              string,
              number | null,
              string | null,
              string,
              string | null,
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
              category,
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
            const [id, item, quantity, meal, directUrl, directProductName, directVerifiedOn, searchUrl, createdAt] =
              boundArgs as [
                string,
                string,
                string | null,
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
              meal,
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
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
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

  it("categorises a new item automatically — no AI call, no user input required", async () => {
    const { rows, db } = createFakeDb();
    await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ name: "Beef mince" }) }),
      db,
      KEY,
    );
    expect(rows()[0]!.category).toBe("Meat & fish");
  });

  it("recategorises when an item is renamed", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Mystery jar", quantity: null, unit: null, location: "Unsorted", status: null, notes: null, category: "Other", added_at: 1, updated_at: 1 },
    ]);
    await familyInventoryApiResponse(
      req("/family/api/inventory/a", { method: "PATCH", key: KEY, body: JSON.stringify({ name: "Cheddar cheese" }) }),
      db,
      KEY,
    );
    expect(rows()[0]!.category).toBe("Dairy & eggs");
  });

  it("uses AI classification to correctly categorise a compound name the keyword list gets wrong", async () => {
    // The keyword list alone puts these in Dairy & eggs ("egg") and Fruit &
    // veg ("onion") respectively — real false positives found in production.
    const { db, rows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '###CATEGORIES_JSON###\n{"Egg tagliatelle": "Tins & packets"}' }],
        }),
        { status: 200 },
      );
    await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ name: "Egg tagliatelle" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(rows()[0]!.category).toBe("Tins & packets");
  });

  it("falls back to the keyword guess when the AI call fails", async () => {
    const { db, rows } = createFakeDb();
    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ name: "Beef mince" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(rows()[0]!.category).toBe("Meat & fish");
  });

  it("reuses a cached category for a repeat item name instead of calling AI again", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Onion chutney", quantity: 1, unit: "jar", location: "Unsorted", status: null, notes: null, category: "Tins & packets", added_at: 1, updated_at: 1 },
    ]);
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      throw new Error("should not be called — the name is already cached");
    };
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { method: "POST", key: KEY, body: JSON.stringify({ name: "onion chutney" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(200);
    expect(callCount).toBe(0);
    expect(rows()[1]!.category).toBe("Tins & packets");
  });

  it("lazily backfills category for rows that predate categorisation, then groups the list by aisle", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Orange juice", quantity: 1, unit: "l", location: "Unsorted", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
      { id: "b", name: "Beef mince", quantity: 500, unit: "g", location: "Unsorted", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
      { id: "c", name: "Carrots", quantity: 200, unit: "g", location: "Unsorted", status: null, notes: null, category: "Fruit & veg", added_at: 1, updated_at: 1 },
    ]);
    const response = await familyInventoryApiResponse(req("/family/api/inventory", { key: KEY }), db, KEY);
    const body = (await response!.json()) as { items: { id: string; category: string }[] };

    // Backfilled in the database, not just in the response.
    expect(rows().find((r) => r.id === "a")!.category).toBe("Drinks");
    expect(rows().find((r) => r.id === "b")!.category).toBe("Meat & fish");

    // Returned already grouped by aisle (Fruit & veg before Meat & fish before Drinks), A-Z within each.
    expect(body.items.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("backfills via a single batched AI call when a key is configured, fixing items the keyword list got wrong", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Egg tagliatelle", quantity: 1, unit: "pack", location: "Unsorted", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
      { id: "b", name: "Onion chutney", quantity: 1, unit: "jar", location: "Unsorted", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
    ]);
    let capturedItemCount = 0;
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { messages: { content: string }[] };
      capturedItemCount = (sentBody.messages[0]!.content.match(/^- /gm) ?? []).length;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: '###CATEGORIES_JSON###\n{"Egg tagliatelle": "Tins & packets", "Onion chutney": "Tins & packets"}',
            },
          ],
        }),
        { status: 200 },
      );
    };

    await familyInventoryApiResponse(req("/family/api/inventory", { key: KEY }), db, KEY, "anthropic-secret", fakeFetch);

    expect(capturedItemCount).toBe(2); // one call covering both rows, not one call each
    expect(rows().find((r) => r.id === "a")!.category).toBe("Tins & packets");
    expect(rows().find((r) => r.id === "b")!.category).toBe("Tins & packets");
  });

  it("updates an item's quantity and bumps updated_at", async () => {
    const { db, rows } = createFakeDb([
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
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
      { id: "a", name: "Milk", quantity: 2, unit: "pints", location: "Fridge", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
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
      { id: "s1", item: "Beef mince", quantity: "750g", meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 200, resolved_at: null },
      { id: "s2", item: "Tinned tomatoes", quantity: "2 tins", meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=tomatoes", status: "pending", created_at: 100, resolved_at: null },
      { id: "s3", item: "Old thing", quantity: null, meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=old", status: "arrived", created_at: 50, resolved_at: 60 },
    ]);
    const response = await familyShoppingListApiResponse(req("/family/api/shopping-list", { key: KEY }), db, KEY);
    const body = (await response!.json()) as { ok: boolean; items: { id: string; item: string }[] };
    expect(body.ok).toBe(true);
    expect(body.items.map((i) => i.id)).toEqual(["s2", "s1"]);
  });

  it("marks an item arrived", async () => {
    const { db, shoppingListRows } = createFakeDb([], [
      { id: "s1", item: "Beef mince", quantity: "750g", meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
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
      { id: "s1", item: "Beef mince", quantity: "750g", meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
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
      { id: "s1", item: "Beef mince", quantity: null, meal: null, direct_url: null, direct_product_name: null, direct_verified_on: null, search_url: "https://tesco.com/search?q=beef", status: "pending", created_at: 100, resolved_at: null },
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

describe("extractShoppingList", () => {
  it("flattens meal-grouped entries into one row per item, keeping the meal label, with Tesco links attached", () => {
    const raw =
      'Menu for the week.\n\n###SHOPPING_LIST_JSON###\n' +
      '[{"meal":"Beef burgers","items":[{"item":"beef mince","quantity":"750g"},{"item":"burger buns","quantity":"1 pack"}]},' +
      '{"meal":"Fruit salad","items":[{"item":"dragon fruit","quantity":"2"}]}]';
    const { plan, shoppingList } = extractShoppingList(raw);
    expect(plan).toBe("Menu for the week.");
    expect(shoppingList).toHaveLength(3);
    expect(shoppingList[0]).toMatchObject({ item: "beef mince", quantity: "750g", meal: "Beef burgers" });
    expect(shoppingList[0]!.directUrl).toContain("tesco.com/shop/en-GB/products/");
    expect(shoppingList[1]).toMatchObject({ item: "burger buns", quantity: "1 pack", meal: "Beef burgers" });
    expect(shoppingList[2]).toMatchObject({ item: "dragon fruit", quantity: "2", meal: "Fruit salad" });
    expect(shoppingList[2]!.directUrl).toBeNull();
    expect(shoppingList[2]!.searchUrl).toContain("tesco.com/shop/en-GB/search");
  });

  it("defaults meal to null when the group has no meal label", () => {
    const raw = 'Menu.\n\n###SHOPPING_LIST_JSON###\n[{"items":[{"item":"beef mince","quantity":"750g"}]}]';
    const { shoppingList } = extractShoppingList(raw);
    expect(shoppingList).toEqual([
      expect.objectContaining({ item: "beef mince", quantity: "750g", meal: null }),
    ]);
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

  it("skips a group whose items field is missing or malformed rather than throwing", () => {
    const raw = 'Menu.\n\n###SHOPPING_LIST_JSON###\n[{"meal":"Mystery"},{"meal":"Burgers","items":[{"item":"buns","quantity":"1"}]}]';
    const { shoppingList } = extractShoppingList(raw);
    expect(shoppingList).toEqual([expect.objectContaining({ item: "buns", meal: "Burgers" })]);
  });
});

describe("extractMeals", () => {
  const inventory = [
    { id: "a", name: "Beef mince", quantity: 500, unit: "g" },
    { id: "b", name: "Spaghetti", quantity: 1000, unit: "g" },
    { id: "c", name: "Garlic", quantity: null, unit: null },
  ];

  it("resolves each meal's own ingredients against the live inventory by exact name match", () => {
    const raw =
      'Two solid options tonight.\n\n###MEALS_JSON###\n' +
      '[{"name":"Spaghetti bolognese","reason":"Classic, uses the mince.","items":[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]},' +
      '{"name":"Garlic bread","reason":"Quick side.","items":[{"item":"Garlic","quantity":1}]}]';
    const { plan, meals } = extractMeals(raw, inventory);
    expect(plan).toBe("Two solid options tonight.");
    expect(meals).toHaveLength(2);
    expect(meals[0]).toEqual({
      name: "Spaghetti bolognese",
      reason: "Classic, uses the mince.",
      usedItems: [
        { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
        { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
      ],
    });
    // Garlic has no known stock quantity, so it can't produce a removable entry —
    // the meal itself still comes through, just with an empty usedItems list.
    expect(meals[1]).toEqual({ name: "Garlic bread", reason: "Quick side.", usedItems: [] });
  });

  it("drops a meal entry with no name", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"reason":"no name given","items":[]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([]);
  });

  it("defaults reason to an empty string when absent", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"name":"Toast","items":[]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([{ name: "Toast", reason: "", usedItems: [] }]);
  });

  it("clamps a suggested removal to what's actually in stock rather than going negative", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"name":"Big dinner","items":[{"item":"Beef mince","quantity":9999}]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals[0]!.usedItems).toEqual([{ id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 500 }]);
  });

  it("returns the whole text with no meals when there is no marker", () => {
    const { plan, meals } = extractMeals("Just pasta.", inventory);
    expect(plan).toBe("Just pasta.");
    expect(meals).toEqual([]);
  });

  it("degrades gracefully on invalid JSON", () => {
    const { plan, meals } = extractMeals("Tacos.\n\n###MEALS_JSON###\nnot json", inventory);
    expect(plan).toBe("Tacos.");
    expect(meals).toEqual([]);
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
      { id: "a", name: "Pulled pork", quantity: 500, unit: "g", location: "Freezer 2 (outside)", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
    ]);
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "You've got one solid dinner in stock." }] }),
        { status: 200 },
      );
    };

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
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
    expect(sentBody.messages[0]!.content).toContain("###MEALS_JSON###");
    expect(sentBody.messages[0]!.content).toContain("###SHOPPING_LIST_JSON###");
    // Location is fully deprecated as a user-facing concept — it must never
    // reach the model, even though the column still exists in the database.
    const fullRequestBody = (capturedInit!.body as string).toLowerCase();
    expect(fullRequestBody).not.toContain("freezer");
    expect(fullRequestBody).not.toContain("location");

    const body = (await response!.json()) as { ok: boolean; plan: string };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("You've got one solid dinner in stock.");
  });

  it("asks for MEALS_JSON before SHOPPING_LIST_JSON (meal block comes first in the reply)", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] }).messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), { status: 200 });
    };
    await familyPlanMealResponse(req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }), db, KEY, "anthropic-secret", fakeFetch);
    expect(sentContent.indexOf("###MEALS_JSON###")).toBeLessThan(sentContent.indexOf("###SHOPPING_LIST_JSON###"));
  });

  it("resolves each returned meal's ingredients into a removable list with real inventory ids", async () => {
    const { db } = createFakeDb([
      { id: "a", name: "Beef mince", quantity: 500, unit: "g", location: "Freezer 2 (outside)", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
      { id: "b", name: "Spaghetti", quantity: 1000, unit: "g", location: "Cupboard", status: null, notes: null, category: null, added_at: 1, updated_at: 1 },
    ]);
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                'Two options tonight.\n\n###MEALS_JSON###\n' +
                '[{"name":"Spaghetti bolognese","reason":"Classic.","items":[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]}]\n\n' +
                '###SHOPPING_LIST_JSON###\n[]',
            },
          ],
        }),
        { status: 200 },
      );

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    const body = (await response!.json()) as {
      ok: boolean;
      plan: string;
      meals: { name: string; reason: string; usedItems: unknown[] }[];
    };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Two options tonight.");
    expect(body.meals).toEqual([
      {
        name: "Spaghetti bolognese",
        reason: "Classic.",
        usedItems: [
          { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
          { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
        ],
      },
    ]);
  });

  it("returns a meal-grouped shopping list with Tesco links attached, and persists it", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                'Lean week.\n\n###MEALS_JSON###\n[]\n\n###SHOPPING_LIST_JSON###\n' +
                '[{"meal":"Beef burgers","items":[{"item":"beef mince","quantity":"750g"}]}]',
            },
          ],
        }),
        { status: 200 },
      );

    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    const body = (await response!.json()) as {
      ok: boolean;
      shoppingList: { id: string; item: string; meal: string | null; directUrl: string | null; status: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.shoppingList).toHaveLength(1);
    expect(body.shoppingList[0]!.item).toBe("beef mince");
    expect(body.shoppingList[0]!.meal).toBe("Beef burgers");
    expect(body.shoppingList[0]!.directUrl).toContain("tesco.com/shop/en-GB/products/");
    expect(body.shoppingList[0]!.status).toBe("pending");
    expect(body.shoppingList[0]!.id).toBeTruthy();
    expect(shoppingListRows()).toHaveLength(1);
  });

  it("persists the shopping list so it survives past this one request, and doesn't duplicate an item still pending from an earlier plan", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                'Lean week.\n\n###MEALS_JSON###\n[]\n\n###SHOPPING_LIST_JSON###\n' +
                '[{"meal":"Beef burgers","items":[{"item":"beef mince","quantity":"750g"}]}]',
            },
          ],
        }),
        { status: 200 },
      );

    await familyPlanMealResponse(req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }), db, KEY, "anthropic-secret", fakeFetch);
    expect(shoppingListRows()).toHaveLength(1);

    // Re-running the planner before the first one arrives must not pile up
    // a second "beef mince" row — it's already pending.
    const secondResponse = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(shoppingListRows()).toHaveLength(1);
    const secondBody = (await secondResponse!.json()) as { shoppingList: { item: string }[] };
    expect(secondBody.shoppingList).toHaveLength(1);
  });

  it("still returns the plan when the model omits both structured blocks", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "Pasta tonight." }] }), { status: 200 });
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    const body = (await response!.json()) as { ok: boolean; plan: string; meals: unknown[]; shoppingList: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Pasta tonight.");
    expect(body.meals).toEqual([]);
    expect(body.shoppingList).toEqual([]);
  });

  it("passes a one-off household note through to the prompt when given", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] }).messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), { status: 200 });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: JSON.stringify({ notes: "7 of us tonight" }) }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toContain("Household note: 7 of us tonight");
  });

  it("instructs the model that a MEALS_JSON entry must be buildable from stock, with no fixed shopping-weekday assumption", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as { system: string; messages: { content: string }[] };
      sentContent = sentBody.messages[0]!.content;
      sentSystem = sentBody.system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), { status: 200 });
    };
    await familyPlanMealResponse(req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }), db, KEY, "anthropic-secret", fakeFetch);
    expect(sentContent).not.toMatch(/next shopping day is/);
    expect(sentSystem).toMatch(/must be fully buildable from what is already in stock right now/i);
    expect(sentSystem).not.toMatch(/fixed weekly cadence/i);
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
