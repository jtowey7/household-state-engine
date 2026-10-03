import { describe, expect, it } from "vitest";
import {
  familyPageResponse,
  familyInventoryApiResponse,
  familyShoppingListApiResponse,
  familyPlanMealResponse,
  familyPlanCookResponse,
  familyMealImageResponse,
  familyPreferencesApiResponse,
  extractAlmostMeals,
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

interface FakeMealImageRow {
  name_key: string;
  image_url: string | null;
  fetched_at: number;
}

interface FakePreferencesRow {
  id: string;
  people_count: number;
  dietary_notes: string | null;
  spice_level: string | null;
  updated_at: number;
}

interface FakeCurrentPlanRow {
  id: string;
  plan_text: string | null;
  meals_json: string;
  almost_json: string;
  generated_at: number;
}

function createFakeDb(
  initialRows: FakeRow[] = [],
  initialShoppingListRows: FakeShoppingListRow[] = [],
  initialMealImageRows: FakeMealImageRow[] = [],
  initialPreferences: FakePreferencesRow = {
    id: "default",
    people_count: 6,
    dietary_notes: null,
    spice_level: null,
    updated_at: 0,
  },
  initialCurrentPlan: FakeCurrentPlanRow | null = null,
): {
  db: D1DatabaseLike;
  rows: () => FakeRow[];
  shoppingListRows: () => FakeShoppingListRow[];
  mealImageRows: () => FakeMealImageRow[];
  preferences: () => FakePreferencesRow;
  currentPlan: () => FakeCurrentPlanRow | null;
} {
  let rows = [...initialRows];
  const shoppingListRows = [...initialShoppingListRows];
  const mealImageRows = [...initialMealImageRows];
  const preferences = { ...initialPreferences };
  let currentPlan: FakeCurrentPlanRow | null = initialCurrentPlan
    ? { ...initialCurrentPlan }
    : null;
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
          if (sql.startsWith("SELECT quantity FROM family_inventory WHERE id = ?")) {
            const [id] = boundArgs as [string];
            const match = rows.find((r) => r.id === id);
            return {
              results: (match ? [{ quantity: match.quantity }] : []) as unknown[],
              success: true,
            };
          }
          if (sql.startsWith("SELECT item FROM family_shopping_list WHERE status = 'pending'")) {
            return {
              results: shoppingListRows.filter((r) => r.status === "pending") as unknown[],
              success: true,
            };
          }
          if (sql.startsWith("SELECT * FROM family_shopping_list WHERE status = 'pending'")) {
            const sorted = shoppingListRows
              .filter((r) => r.status === "pending")
              .sort((a, b) => a.created_at - b.created_at);
            return { results: sorted as unknown[], success: true };
          }
          if (sql.startsWith("SELECT image_url FROM meal_image_cache WHERE name_key = ?")) {
            const [nameKey] = boundArgs as [string];
            const match = mealImageRows.find((r) => r.name_key === nameKey);
            return {
              results: (match ? [{ image_url: match.image_url }] : []) as unknown[],
              success: true,
            };
          }
          if (sql.startsWith("SELECT * FROM family_preferences WHERE id = 'default'")) {
            return { results: [preferences] as unknown[], success: true };
          }
          if (
            sql.startsWith(
              "SELECT plan_text, meals_json, almost_json, generated_at FROM family_current_plan",
            )
          ) {
            return { results: (currentPlan ? [currentPlan] : []) as unknown[], success: true };
          }
          throw new Error(`Unhandled SELECT in fake db: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO family_inventory")) {
            const [id, name, quantity, unit, location, notes, category, addedAt, updatedAt] =
              boundArgs as [
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
            const [
              id,
              item,
              quantity,
              meal,
              directUrl,
              directProductName,
              directVerifiedOn,
              searchUrl,
              createdAt,
            ] = boundArgs as [
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
          if (sql.startsWith("INSERT INTO meal_image_cache")) {
            const [nameKey, imageUrl, fetchedAt] = boundArgs as [string, string | null, number];
            const existing = mealImageRows.find((r) => r.name_key === nameKey);
            if (existing) {
              existing.image_url = imageUrl;
              existing.fetched_at = fetchedAt;
            } else {
              mealImageRows.push({ name_key: nameKey, image_url: imageUrl, fetched_at: fetchedAt });
            }
            return { results: [], success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE family_preferences SET")) {
            const setClause = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).trim();
            const cols = setClause.split(",").map((c) => c.trim().split("=")[0]!.trim());
            cols.forEach((col, i) => {
              (preferences as unknown as Record<string, unknown>)[col] = boundArgs[i];
            });
            return { results: [], success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO family_current_plan")) {
            const [planText, mealsJson, almostJson, generatedAt] = boundArgs as [
              string | null,
              string,
              string,
              number,
            ];
            currentPlan = {
              id: "default",
              plan_text: planText,
              meals_json: mealsJson,
              almost_json: almostJson,
              generated_at: generatedAt,
            };
            return { results: [], success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unhandled statement in fake db: ${sql}`);
        },
      };
      return statement;
    },
  };
  return {
    db,
    rows: () => rows,
    shoppingListRows: () => shoppingListRows,
    mealImageRows: () => mealImageRows,
    preferences: () => preferences,
    currentPlan: () => currentPlan,
  };
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
      {
        id: "a",
        name: "Milk",
        quantity: 2,
        unit: "pints",
        location: "Fridge",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { ok: boolean; items: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: "a", name: "Milk", quantity: 2, location: "Fridge" });
  });

  it("refuses to add an item without a name", async () => {
    const { db } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ quantity: 1 }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });

  it("adds an item with defaults when location/unit are omitted", async () => {
    const { db, rows } = createFakeDb();
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "Pulled pork" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      name: "Pulled pork",
      location: "Unsorted",
      quantity: null,
      unit: null,
    });
  });

  it("categorises a new item automatically — no AI call, no user input required", async () => {
    const { rows, db } = createFakeDb();
    await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "Beef mince" }),
      }),
      db,
      KEY,
    );
    expect(rows()[0]!.category).toBe("Meat & fish");
  });

  it("recategorises when an item is renamed", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Mystery jar",
        quantity: null,
        unit: null,
        location: "Unsorted",
        status: null,
        notes: null,
        category: "Other",
        added_at: 1,
        updated_at: 1,
      },
    ]);
    await familyInventoryApiResponse(
      req("/family/api/inventory/a", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ name: "Cheddar cheese" }),
      }),
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
          content: [
            { type: "text", text: '###CATEGORIES_JSON###\n{"Egg tagliatelle": "Tins & packets"}' },
          ],
        }),
        { status: 200 },
      );
    await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "Egg tagliatelle" }),
      }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(rows()[0]!.category).toBe("Tins & packets");
  });

  it("still classifies when the model wraps its JSON object in a markdown code fence", async () => {
    const { db, rows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: '###CATEGORIES_JSON###\n```json\n{"Egg tagliatelle": "Tins & packets"}\n```',
            },
          ],
        }),
        { status: 200 },
      );
    await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "Egg tagliatelle" }),
      }),
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
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "Beef mince" }),
      }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(rows()[0]!.category).toBe("Meat & fish");
  });

  it("reuses a cached category for a repeat item name instead of calling AI again", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Onion chutney",
        quantity: 1,
        unit: "jar",
        location: "Unsorted",
        status: null,
        notes: null,
        category: "Tins & packets",
        added_at: 1,
        updated_at: 1,
      },
    ]);
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      throw new Error("should not be called — the name is already cached");
    };
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ name: "onion chutney" }),
      }),
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
      {
        id: "a",
        name: "Orange juice",
        quantity: 1,
        unit: "l",
        location: "Unsorted",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
      {
        id: "b",
        name: "Beef mince",
        quantity: 500,
        unit: "g",
        location: "Unsorted",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
      {
        id: "c",
        name: "Carrots",
        quantity: 200,
        unit: "g",
        location: "Unsorted",
        status: null,
        notes: null,
        category: "Fruit & veg",
        added_at: 1,
        updated_at: 1,
      },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { items: { id: string; category: string }[] };

    // Backfilled in the database, not just in the response.
    expect(rows().find((r) => r.id === "a")!.category).toBe("Drinks");
    expect(rows().find((r) => r.id === "b")!.category).toBe("Meat & fish");

    // Returned already grouped by aisle (Fruit & veg before Meat & fish before Drinks), A-Z within each.
    expect(body.items.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("lazily cleans up a brand-prefixed name on GET, persisting the cleaned name to the row", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Tesco Whole Cucumber Each",
        quantity: 2,
        unit: "each",
        location: "Unsorted",
        status: null,
        notes: null,
        category: "Fruit & veg",
        added_at: 1,
        updated_at: 1,
      },
      {
        id: "b",
        name: "Onions",
        quantity: 3,
        unit: "each",
        location: "Unsorted",
        status: null,
        notes: null,
        category: "Fruit & veg",
        added_at: 1,
        updated_at: 1,
      },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { items: { id: string; name: string }[] };

    expect(rows().find((r) => r.id === "a")!.name).toBe("Whole Cucumber");
    expect(rows().find((r) => r.id === "b")!.name).toBe("Onions");
    expect(body.items.find((i) => i.id === "a")!.name).toBe("Whole Cucumber");
  });

  it("backfills via a single batched AI call when a key is configured, fixing items the keyword list got wrong", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Egg tagliatelle",
        quantity: 1,
        unit: "pack",
        location: "Unsorted",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
      {
        id: "b",
        name: "Onion chutney",
        quantity: 1,
        unit: "jar",
        location: "Unsorted",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
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

    await familyInventoryApiResponse(
      req("/family/api/inventory", { key: KEY }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );

    expect(capturedItemCount).toBe(2); // one call covering both rows, not one call each
    expect(rows().find((r) => r.id === "a")!.category).toBe("Tins & packets");
    expect(rows().find((r) => r.id === "b")!.category).toBe("Tins & packets");
  });

  it("updates an item's quantity and bumps updated_at", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Milk",
        quantity: 2,
        unit: "pints",
        location: "Fridge",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
    ]);
    const response = await familyInventoryApiResponse(
      req("/family/api/inventory/a", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ quantity: 1 }),
      }),
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
      req("/family/api/inventory/missing", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ quantity: 1 }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
  });

  it("removes an item", async () => {
    const { db, rows } = createFakeDb([
      {
        id: "a",
        name: "Milk",
        quantity: 2,
        unit: "pints",
        location: "Fridge",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
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
    expect(
      await familyShoppingListApiResponse(req("/family/api/inventory"), db, KEY),
    ).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list"),
      db,
      undefined,
    );
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
    const { db } = createFakeDb(
      [],
      [
        {
          id: "s1",
          item: "Beef mince",
          quantity: "750g",
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=beef",
          status: "pending",
          created_at: 200,
          resolved_at: null,
        },
        {
          id: "s2",
          item: "Tinned tomatoes",
          quantity: "2 tins",
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=tomatoes",
          status: "pending",
          created_at: 100,
          resolved_at: null,
        },
        {
          id: "s3",
          item: "Old thing",
          quantity: null,
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=old",
          status: "arrived",
          created_at: 50,
          resolved_at: 60,
        },
      ],
    );
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { ok: boolean; items: { id: string; item: string }[] };
    expect(body.ok).toBe(true);
    expect(body.items.map((i) => i.id)).toEqual(["s2", "s1"]);
  });

  it("marks an item arrived", async () => {
    const { db, shoppingListRows } = createFakeDb(
      [],
      [
        {
          id: "s1",
          item: "Beef mince",
          quantity: "750g",
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=beef",
          status: "pending",
          created_at: 100,
          resolved_at: null,
        },
      ],
    );
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ status: "arrived" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(shoppingListRows()[0]!.status).toBe("arrived");
    expect(shoppingListRows()[0]!.resolved_at).not.toBeNull();

    const listResponse = await familyShoppingListApiResponse(
      req("/family/api/shopping-list", { key: KEY }),
      db,
      KEY,
    );
    const body = (await listResponse!.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("marks an item cancelled", async () => {
    const { db, shoppingListRows } = createFakeDb(
      [],
      [
        {
          id: "s1",
          item: "Beef mince",
          quantity: "750g",
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=beef",
          status: "pending",
          created_at: 100,
          resolved_at: null,
        },
      ],
    );
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ status: "cancelled" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(shoppingListRows()[0]!.status).toBe("cancelled");
  });

  it("rejects an invalid status", async () => {
    const { db } = createFakeDb(
      [],
      [
        {
          id: "s1",
          item: "Beef mince",
          quantity: null,
          meal: null,
          direct_url: null,
          direct_product_name: null,
          direct_verified_on: null,
          search_url: "https://tesco.com/search?q=beef",
          status: "pending",
          created_at: 100,
          resolved_at: null,
        },
      ],
    );
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/s1", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ status: "bogus" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });

  it("404s resolving an item that doesn't exist", async () => {
    const { db } = createFakeDb();
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/missing", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ status: "arrived" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
  });

  it("unlock: adds an almost-there meal's missing items to the shopping list, with Tesco links attached", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/unlock", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({
          meal: "Beef burgers",
          items: [{ item: "beef mince", quantity: "750g" }],
        }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as {
      ok: boolean;
      items: { item: string; meal: string | null }[];
    };
    expect(body.ok).toBe(true);
    expect(body.items).toEqual([
      expect.objectContaining({ item: "beef mince", meal: "Beef burgers" }),
    ]);
    expect(shoppingListRows()).toHaveLength(1);
    expect(shoppingListRows()[0]!.direct_url).toContain("tesco.com/shop/en-GB/products/");
  });

  it("unlock: skips an item with no name rather than throwing", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const response = await familyShoppingListApiResponse(
      req("/family/api/shopping-list/unlock", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ meal: "Beef burgers", items: [{ quantity: "750g" }] }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
    expect(shoppingListRows()).toHaveLength(0);
  });

  it("unlock: doesn't duplicate an item that's already pending from an earlier unlock", async () => {
    const { db, shoppingListRows } = createFakeDb();
    const unlock = () =>
      familyShoppingListApiResponse(
        req("/family/api/shopping-list/unlock", {
          method: "POST",
          key: KEY,
          body: JSON.stringify({
            meal: "Beef burgers",
            items: [{ item: "beef mince", quantity: "750g" }],
          }),
        }),
        db,
        KEY,
      );
    await unlock();
    expect(shoppingListRows()).toHaveLength(1);
    await unlock();
    expect(shoppingListRows()).toHaveLength(1);
  });
});

describe("familyPreferencesApiResponse", () => {
  it("ignores unrelated paths", async () => {
    const { db } = createFakeDb();
    expect(
      await familyPreferencesApiResponse(req("/family/api/inventory"), db, KEY),
    ).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences"),
      db,
      undefined,
    );
    expect(response!.status).toBe(401);
  });

  it("503s when the database isn't configured", async () => {
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", { key: KEY }),
      undefined,
      KEY,
    );
    expect(response!.status).toBe(503);
  });

  it("GET returns the stored defaults", async () => {
    const { db } = createFakeDb([], [], [], {
      id: "default",
      people_count: 8,
      dietary_notes: "no nuts",
      spice_level: "hot",
      updated_at: 0,
    });
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as {
      ok: boolean;
      peopleCount: number;
      dietaryNotes: string | null;
      spiceLevel: string | null;
    };
    expect(body).toEqual({ ok: true, peopleCount: 8, dietaryNotes: "no nuts", spiceLevel: "hot" });
  });

  it("GET falls back to a household of 6 with no dietary constraints when nothing has been saved", async () => {
    const { db } = createFakeDb();
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", { key: KEY }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { ok: boolean; peopleCount: number };
    expect(body).toEqual({ ok: true, peopleCount: 6, dietaryNotes: null, spiceLevel: null });
  });

  it("PATCH updates only the fields given", async () => {
    const { db, preferences } = createFakeDb();
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ peopleCount: 9 }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(200);
    expect(preferences().people_count).toBe(9);
    const body = (await response!.json()) as { ok: boolean; peopleCount: number };
    expect(body.peopleCount).toBe(9);
  });

  it("PATCH clears a field by sending null", async () => {
    const { db, preferences } = createFakeDb([], [], [], {
      id: "default",
      people_count: 6,
      dietary_notes: "no nuts",
      spice_level: "hot",
      updated_at: 0,
    });
    await familyPreferencesApiResponse(
      req("/family/api/preferences", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ dietaryNotes: null }),
      }),
      db,
      KEY,
    );
    expect(preferences().dietary_notes).toBeNull();
    expect(preferences().spice_level).toBe("hot");
  });

  it("rejects a non-positive people count", async () => {
    const { db } = createFakeDb();
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", {
        method: "PATCH",
        key: KEY,
        body: JSON.stringify({ peopleCount: 0 }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });

  it("400s when no recognised field is given", async () => {
    const { db } = createFakeDb();
    const response = await familyPreferencesApiResponse(
      req("/family/api/preferences", { method: "PATCH", key: KEY, body: JSON.stringify({}) }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });
});

describe("extractAlmostMeals", () => {
  it("parses near-miss meals with their missing items", () => {
    const raw =
      "Menu for the week.\n\n###ALMOST_JSON###\n" +
      '[{"name":"Beef burgers","reason":"Just needs buns.","photoQuery":"beef burgers","missing":[{"item":"burger buns","quantity":"1 pack"}]},' +
      '{"name":"Fruit salad","reason":"Needs more fruit.","photoQuery":"fruit salad","missing":[{"item":"dragon fruit","quantity":"2"}]}]';
    const { plan, almostMeals } = extractAlmostMeals(raw);
    expect(plan).toBe("Menu for the week.");
    expect(almostMeals).toEqual([
      {
        name: "Beef burgers",
        reason: "Just needs buns.",
        photoQuery: "beef burgers",
        missing: [{ item: "burger buns", quantity: "1 pack" }],
      },
      {
        name: "Fruit salad",
        reason: "Needs more fruit.",
        photoQuery: "fruit salad",
        missing: [{ item: "dragon fruit", quantity: "2" }],
      },
    ]);
  });

  it("falls back to the display name as the photo query when the model omits photoQuery", () => {
    const raw =
      'Menu.\n\n###ALMOST_JSON###\n[{"name":"Beef burgers","missing":[{"item":"buns","quantity":"1"}]}]';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals[0]!.photoQuery).toBe("Beef burgers");
  });

  it("drops a meal entry with no missing items — it isn't actually 'almost' anything", () => {
    const raw = 'Menu.\n\n###ALMOST_JSON###\n[{"name":"Beef burgers","missing":[]}]';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals).toEqual([]);
  });

  it("drops a meal entry with no name", () => {
    const raw = 'Menu.\n\n###ALMOST_JSON###\n[{"missing":[{"item":"buns","quantity":"1"}]}]';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals).toEqual([]);
  });

  it("returns the whole text with an empty list when there is no marker", () => {
    const { plan, almostMeals } = extractAlmostMeals("Just have pasta tonight.");
    expect(plan).toBe("Just have pasta tonight.");
    expect(almostMeals).toEqual([]);
  });

  it("degrades gracefully when the trailing block isn't valid JSON", () => {
    const { plan, almostMeals } = extractAlmostMeals(
      "Day 1: tacos.\n\n###ALMOST_JSON###\nnot json",
    );
    expect(plan).toBe("Day 1: tacos.");
    expect(almostMeals).toEqual([]);
  });

  it("still parses when the model wraps the JSON in a markdown code fence despite being told not to", () => {
    const raw =
      'Menu.\n\n###ALMOST_JSON###\n```json\n[{"name":"Burgers","missing":[{"item":"buns","quantity":"1"}]}]\n```';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals).toEqual([
      expect.objectContaining({ name: "Burgers", missing: [{ item: "buns", quantity: "1" }] }),
    ]);
  });

  it("still parses when the model adds a stray trailing sentence after the JSON array", () => {
    const raw =
      'Menu.\n\n###ALMOST_JSON###\n[{"name":"Burgers","missing":[{"item":"buns","quantity":"1"}]}]\nHope that helps!';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals).toEqual([
      expect.objectContaining({ name: "Burgers", missing: [{ item: "buns", quantity: "1" }] }),
    ]);
  });

  it("skips a malformed missing entry rather than throwing", () => {
    const raw =
      'Menu.\n\n###ALMOST_JSON###\n[{"name":"Burgers","missing":[{"quantity":"1"},{"item":"buns","quantity":"1"}]}]';
    const { almostMeals } = extractAlmostMeals(raw);
    expect(almostMeals).toEqual([
      expect.objectContaining({ name: "Burgers", missing: [{ item: "buns", quantity: "1" }] }),
    ]);
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
      "Two solid options tonight.\n\n###MEALS_JSON###\n" +
      '[{"name":"Spaghetti bolognese","reason":"Classic, uses the mince.","photoQuery":"spaghetti bolognese","items":[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]},' +
      '{"name":"Garlic bread","reason":"Quick side.","photoQuery":"garlic bread","items":[{"item":"Garlic","quantity":1}]}]';
    const { plan, meals } = extractMeals(raw, inventory);
    expect(plan).toBe("Two solid options tonight.");
    expect(meals).toHaveLength(2);
    expect(meals[0]).toEqual({
      name: "Spaghetti bolognese",
      reason: "Classic, uses the mince.",
      photoQuery: "spaghetti bolognese",
      usedItems: [
        { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
        { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
      ],
    });
    // Garlic has no known stock quantity, so it can't produce a removable entry —
    // the meal itself still comes through, just with an empty usedItems list.
    expect(meals[1]).toEqual({
      name: "Garlic bread",
      reason: "Quick side.",
      photoQuery: "garlic bread",
      usedItems: [],
    });
  });

  it("falls back to the display name as the photo query when the model omits photoQuery", () => {
    const raw =
      'Dinner.\n\n###MEALS_JSON###\n[{"name":"Chicken & bacon pies with mash and veg","items":[]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals[0]!.photoQuery).toBe("Chicken & bacon pies with mash and veg");
  });

  it("drops a meal entry with no name", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"reason":"no name given","items":[]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([]);
  });

  it("defaults reason to an empty string when absent", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"name":"Toast","items":[]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([{ name: "Toast", reason: "", photoQuery: "Toast", usedItems: [] }]);
  });

  it("clamps a suggested removal to what's actually in stock rather than going negative", () => {
    const raw =
      'Dinner.\n\n###MEALS_JSON###\n[{"name":"Big dinner","items":[{"item":"Beef mince","quantity":9999}]}]';
    const { meals } = extractMeals(raw, inventory);
    expect(meals[0]!.usedItems).toEqual([
      { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 500 },
    ]);
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

  it("still parses when the model wraps the JSON in a markdown code fence despite being told not to", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n```json\n[{"name":"Toast","items":[]}]\n```';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([{ name: "Toast", reason: "", photoQuery: "Toast", usedItems: [] }]);
  });

  it("still parses when the model adds a stray trailing sentence after the JSON array", () => {
    const raw = 'Dinner.\n\n###MEALS_JSON###\n[{"name":"Toast","items":[]}]\nHope that helps!';
    const { meals } = extractMeals(raw, inventory);
    expect(meals).toEqual([{ name: "Toast", reason: "", photoQuery: "Toast", usedItems: [] }]);
  });
});

describe("familyPlanMealResponse", () => {
  it("ignores unrelated paths/methods", async () => {
    const { db } = createFakeDb();
    expect(
      await familyPlanMealResponse(req("/family/api/inventory"), db, KEY, "anthropic-key"),
    ).toBeUndefined();
    expect(
      await familyPlanMealResponse(
        req("/family/api/plan-meal", { method: "DELETE" }),
        db,
        KEY,
        "anthropic-key",
      ),
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
      {
        id: "a",
        name: "Pulled pork",
        quantity: 500,
        unit: "g",
        location: "Freezer 2 (outside)",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
    ]);
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "You've got one solid dinner in stock." }],
        }),
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
    const sentBody = JSON.parse(capturedInit!.body as string) as {
      model: string;
      messages: { content: string }[];
    };
    expect(sentBody.model).toBe("claude-sonnet-5");
    expect(sentBody.messages[0]!.content).toContain("Pulled pork");
    expect(sentBody.messages[0]!.content).toContain("###MEALS_JSON###");
    expect(sentBody.messages[0]!.content).toContain("###ALMOST_JSON###");
    // Location is fully deprecated as a user-facing concept — it must never
    // reach the model, even though the column still exists in the database.
    const fullRequestBody = (capturedInit!.body as string).toLowerCase();
    expect(fullRequestBody).not.toContain("freezer");
    expect(fullRequestBody).not.toContain("location");

    const body = (await response!.json()) as { ok: boolean; plan: string };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("You've got one solid dinner in stock.");
  });

  it("asks for MEALS_JSON before ALMOST_JSON (meal block comes first in the reply)", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] })
        .messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent.indexOf("###MEALS_JSON###")).toBeLessThan(
      sentContent.indexOf("###ALMOST_JSON###"),
    );
  });

  it("resolves each returned meal's ingredients into a removable list with real inventory ids", async () => {
    const { db } = createFakeDb([
      {
        id: "a",
        name: "Beef mince",
        quantity: 500,
        unit: "g",
        location: "Freezer 2 (outside)",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
      {
        id: "b",
        name: "Spaghetti",
        quantity: 1000,
        unit: "g",
        location: "Cupboard",
        status: null,
        notes: null,
        category: null,
        added_at: 1,
        updated_at: 1,
      },
    ]);
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                "Two options tonight.\n\n###MEALS_JSON###\n" +
                '[{"name":"Spaghetti bolognese","reason":"Classic.","items":[{"item":"Beef mince","quantity":250},{"item":"Spaghetti","quantity":300}]}]\n\n' +
                "###ALMOST_JSON###\n[]",
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
        photoQuery: "Spaghetti bolognese",
        usedItems: [
          { id: "a", name: "Beef mince", unit: "g", currentQuantity: 500, suggestedRemove: 250 },
          { id: "b", name: "Spaghetti", unit: "g", currentQuantity: 1000, suggestedRemove: 300 },
        ],
      },
    ]);
  });

  it("returns the almost-there meals with their missing items, unresolved against the Tesco catalogue (that happens only on unlock)", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                "Lean week.\n\n###MEALS_JSON###\n[]\n\n###ALMOST_JSON###\n" +
                '[{"name":"Beef burgers","reason":"Just needs buns.","photoQuery":"beef burgers","missing":[{"item":"beef mince","quantity":"750g"}]}]',
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
      almostMeals: {
        name: string;
        reason: string;
        photoQuery: string;
        missing: { item: string; quantity: string }[];
      }[];
    };
    expect(body.ok).toBe(true);
    expect(body.almostMeals).toEqual([
      {
        name: "Beef burgers",
        reason: "Just needs buns.",
        photoQuery: "beef burgers",
        missing: [{ item: "beef mince", quantity: "750g" }],
      },
    ]);
  });

  it("never persists anything to the shopping list just from planning — only an explicit unlock does that", async () => {
    // This is the core fix for the old behaviour: every plan-meal call used
    // to silently queue up to 12 items whether or not the household wanted
    // them, so pending counts crept up (72+ items nobody chose) with no way
    // to tell what was actually wanted. Planning must now only ever surface
    // candidates; persisting happens exclusively via the unlock endpoint.
    const { db, shoppingListRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text:
                "Lean week.\n\n###MEALS_JSON###\n[]\n\n###ALMOST_JSON###\n" +
                '[{"name":"Beef burgers","missing":[{"item":"beef mince","quantity":"750g"}]}]',
            },
          ],
        }),
        { status: 200 },
      );

    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(shoppingListRows()).toHaveLength(0);
  });

  it("still returns the plan when the model omits both structured blocks", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "Pasta tonight." }] }), {
        status: 200,
      });
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
      meals: unknown[];
      almostMeals: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Pasta tonight.");
    expect(body.meals).toEqual([]);
    expect(body.almostMeals).toEqual([]);
  });

  it("passes a one-off household note through to the prompt when given", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] })
        .messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ notes: "7 of us tonight" }),
      }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(/one-off note for this planning run only/i);
    expect(sentContent).toContain("7 of us tonight");
  });

  it("instructs the model that a MEALS_JSON entry must be buildable from stock, with no fixed shopping-weekday assumption", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as {
        system: string;
        messages: { content: string }[];
      };
      sentContent = sentBody.messages[0]!.content;
      sentSystem = sentBody.system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).not.toMatch(/next shopping day is/);
    expect(sentSystem).toMatch(/must be fully buildable from what is already in stock right now/i);
    expect(sentSystem).not.toMatch(/fixed weekly cadence/i);
  });

  it("caps almost-there meals at 8 and keeps the MEALS_JSON block mandatory", async () => {
    // First-pass regression coverage for a real production miss: the model
    // wrote a full paragraph naming all 6 meals in prose, then omitted the
    // MEALS_JSON block entirely. This loosely-worded "one short sentence
    // with a count" fix reduced but did not eliminate the contradiction (it
    // recurred later in production) — see the "never state a count" test
    // below for the structural fix that replaced this wording.
    const { db } = createFakeDb();
    let sentContent = "";
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as {
        system: string;
        messages: { content: string }[];
      };
      sentContent = sentBody.messages[0]!.content;
      sentSystem = sentBody.system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(/up to 8 "almost there" meals/i);
    expect(sentSystem).toMatch(/MEALS_JSON block is mandatory/i);
  });

  it("instructs the model to keep surfacing a minimum of almost-there meals even once MEALS_JSON is well stocked, so the row doesn't just drop away", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] })
        .messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(
      /even when MEALS_JSON already has several ready meals.*at least 1-3/i,
    );
  });

  it("instructs the model to abstract photoQuery to a recognisable umbrella dish term, not the full recipe", async () => {
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] })
        .messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(/ABSTRACTED to the most common, recognisable umbrella term/i);
    expect(sentContent).toContain(
      '"Steak and gravy pie with mash and broccoli" becomes "pie and mash"',
    );
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

  it("sends adaptive thinking at medium effort, for reliable MEALS_JSON compliance", async () => {
    const { db } = createFakeDb();
    let sentBody: { thinking?: unknown; output_config?: unknown } = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Pasta." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentBody.thinking).toEqual({ type: "adaptive" });
    expect(sentBody.output_config).toEqual({ effort: "medium" });
  });

  it("instructs the model never to state a meal count in prose, since the count is read from MEALS_JSON directly", async () => {
    // Regression coverage: production showed the model stating "This
    // covers 6 genuine dinners" in prose while MEALS_JSON came back empty —
    // a second occurrence of the same contradiction class after the first
    // "mandatory block" wording fix, which reduced but didn't eliminate it.
    // The real fix is structural: stop asking for a count in two places.
    const { db } = createFakeDb();
    let sentContent = "";
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const sentBody = JSON.parse(init!.body as string) as {
        system: string;
        messages: { content: string }[];
      };
      sentContent = sentBody.messages[0]!.content;
      sentSystem = sentBody.system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toMatch(/never state a count or number of meals here/i);
    expect(sentSystem).toMatch(/only place meal names, descriptions or counts may appear/i);
  });

  it("asks for a separate, unambiguous photoQuery per meal rather than reusing the display name for photo search", async () => {
    // Production showed meal photos missing or wrong (a blank space for a
    // compound name like "Chicken & bacon pies with mash and veg", a clearly
    // unrelated image for others) because the photo search used the full,
    // often-compound display name verbatim. A client-side heuristic to trim
    // it helped some cases but not others, since the model phrases meal
    // names inconsistently across calls — a dedicated model-authored field
    // is the reliable fix, not another string-matching heuristic.
    const { db } = createFakeDb();
    let sentContent = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentContent = (JSON.parse(init!.body as string) as { messages: { content: string }[] })
        .messages[0]!.content;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentContent).toContain('"photoQuery": string');
    expect(sentContent).toMatch(/generic dish name for a stock-photo search/i);
    expect(sentContent).toMatch(/not bare "turkey"/i);
  });

  it("bakes the stored household size into the prompt instead of a hardcoded number", async () => {
    const { db } = createFakeDb([], [], [], {
      id: "default",
      people_count: 9,
      dietary_notes: null,
      spice_level: null,
      updated_at: 0,
    });
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentSystem = (JSON.parse(init!.body as string) as { system: string }).system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentSystem).toMatch(/household of 9\b/);
  });

  it("defaults to a household of 6 when no preferences have been saved", async () => {
    const { db } = createFakeDb();
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentSystem = (JSON.parse(init!.body as string) as { system: string }).system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentSystem).toMatch(/household of 6\b/);
  });

  it("includes stored dietary constraints and spice preference in the system prompt when set", async () => {
    const { db } = createFakeDb([], [], [], {
      id: "default",
      people_count: 6,
      dietary_notes: "no shellfish, no nuts",
      spice_level: "mild",
      updated_at: 0,
    });
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentSystem = (JSON.parse(init!.body as string) as { system: string }).system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentSystem).toContain("no shellfish, no nuts");
    expect(sentSystem).toMatch(/spice preference: mild/i);
  });

  it("omits the dietary-constraints and spice-preference lines entirely when neither is set", async () => {
    const { db } = createFakeDb();
    let sentSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      sentSystem = (JSON.parse(init!.body as string) as { system: string }).system;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menu." }] }), {
        status: 200,
      });
    };
    await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    expect(sentSystem).not.toMatch(/dietary constraints/i);
    expect(sentSystem).not.toMatch(/spice preference/i);
  });

  it("persists the generated plan so it survives a reload, and GET returns it back", async () => {
    const { db, currentPlan } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: 'Tacos tonight.\n\n###MEALS_JSON###\n[{"name":"Tacos","reason":"","photoQuery":"tacos","items":[]}]',
            },
          ],
        }),
        { status: 200 },
      );
    const postResponse = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
      "anthropic-secret",
      fakeFetch,
    );
    const postBody = (await postResponse!.json()) as { ok: boolean; generatedAt: number };
    expect(postBody.ok).toBe(true);
    expect(typeof postBody.generatedAt).toBe("number");
    expect(currentPlan()).not.toBeNull();
    expect(currentPlan()!.plan_text).toBe("Tacos tonight.");
    expect(JSON.parse(currentPlan()!.meals_json)).toEqual([
      { name: "Tacos", reason: "", photoQuery: "tacos", usedItems: [] },
    ]);

    const getResponse = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "GET", key: KEY }),
      db,
      KEY,
      "anthropic-secret",
    );
    const getBody = (await getResponse!.json()) as {
      ok: boolean;
      plan: string;
      meals: unknown[];
      almostMeals: unknown[];
      generatedAt: number;
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.plan).toBe("Tacos tonight.");
    expect(getBody.meals).toEqual([
      { name: "Tacos", reason: "", photoQuery: "tacos", usedItems: [] },
    ]);
    expect(getBody.almostMeals).toEqual([]);
    expect(getBody.generatedAt).toBe(postBody.generatedAt);
  });

  it("GET returns an empty shape (not an error) when no plan has ever been generated", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "GET", key: KEY }),
      db,
      KEY,
      "anthropic-secret",
    );
    const body = (await response!.json()) as {
      ok: boolean;
      plan: string;
      meals: unknown[];
      almostMeals: unknown[];
      generatedAt: number | null;
    };
    expect(body).toEqual({ ok: true, plan: "", meals: [], almostMeals: [], generatedAt: null });
  });

  it("GET still requires a valid family key and a configured database, same as POST", async () => {
    const { db } = createFakeDb();
    const unauthed = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "GET" }),
      db,
      KEY,
      "anthropic-secret",
    );
    expect(unauthed!.status).toBe(401);

    const noDb = await familyPlanMealResponse(
      req("/family/api/plan-meal", { method: "GET", key: KEY }),
      undefined,
      KEY,
      "anthropic-secret",
    );
    expect(noDb!.status).toBe(503);
  });
});

describe("familyPlanCookResponse", () => {
  it("ignores unrelated paths/methods", async () => {
    const { db } = createFakeDb();
    expect(
      await familyPlanCookResponse(req("/family/api/plan-meal", { method: "POST" }), db, KEY),
    ).toBeUndefined();
    expect(
      await familyPlanCookResponse(req("/family/api/plan-meal/cook", { method: "GET" }), db, KEY),
    ).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanCookResponse(
      req("/family/api/plan-meal/cook", { method: "POST", body: "{}" }),
      db,
      KEY,
    );
    expect(response!.status).toBe(401);
  });

  it("decrements each used item against its LIVE inventory quantity and removes the meal from the stored plan", async () => {
    const { db, rows, currentPlan } = createFakeDb(
      [
        {
          id: "mince-1",
          name: "Beef mince",
          quantity: 500,
          unit: "g",
          location: "Freezer",
          status: null,
          notes: null,
          category: "Meat",
          added_at: 0,
          updated_at: 0,
        },
      ],
      [],
      [],
      undefined,
      {
        id: "default",
        plan_text: "Tacos tonight.",
        meals_json: JSON.stringify([
          {
            name: "Tacos",
            reason: "",
            photoQuery: "tacos",
            usedItems: [
              {
                id: "mince-1",
                name: "Beef mince",
                unit: "g",
                currentQuantity: 500,
                suggestedRemove: 300,
              },
            ],
          },
          { name: "Toast", reason: "", photoQuery: "toast", usedItems: [] },
        ]),
        almost_json: "[]",
        generated_at: 1000,
      },
    );
    // Someone else used some mince between plan generation and cooking —
    // the live quantity (200) is now lower than the 500 captured when the
    // plan was made. A fix based on the stale snapshot would wrongly reset
    // it back up; the live decrement must come off this current value.
    rows()[0]!.quantity = 200;

    const response = await familyPlanCookResponse(
      req("/family/api/plan-meal/cook", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ mealName: "Tacos" }),
      }),
      db,
      KEY,
    );
    const body = (await response!.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(rows()[0]!.quantity).toBe(0); // max(0, 200 - 300)

    const stored = currentPlan()!;
    expect(JSON.parse(stored.meals_json)).toEqual([
      { name: "Toast", reason: "", photoQuery: "toast", usedItems: [] },
    ]);
  });

  it("matches the meal by name case-insensitively", async () => {
    const { db, currentPlan } = createFakeDb([], [], [], undefined, {
      id: "default",
      plan_text: "",
      meals_json: JSON.stringify([
        { name: "Tacos", reason: "", photoQuery: "tacos", usedItems: [] },
      ]),
      almost_json: "[]",
      generated_at: 1000,
    });
    const response = await familyPlanCookResponse(
      req("/family/api/plan-meal/cook", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ mealName: "  TACOS  " }),
      }),
      db,
      KEY,
    );
    expect((await response!.json()) as { ok: boolean }).toEqual({ ok: true });
    expect(JSON.parse(currentPlan()!.meals_json)).toEqual([]);
  });

  it("404s with a clear message when the meal is no longer in the current plan (already cooked elsewhere, or no plan at all)", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanCookResponse(
      req("/family/api/plan-meal/cook", {
        method: "POST",
        key: KEY,
        body: JSON.stringify({ mealName: "Tacos" }),
      }),
      db,
      KEY,
    );
    expect(response!.status).toBe(404);
    const body = (await response!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no longer in the current plan/i);
  });

  it("400s when mealName is missing", async () => {
    const { db } = createFakeDb();
    const response = await familyPlanCookResponse(
      req("/family/api/plan-meal/cook", { method: "POST", key: KEY, body: "{}" }),
      db,
      KEY,
    );
    expect(response!.status).toBe(400);
  });
});

describe("familyMealImageResponse", () => {
  it("ignores unrelated paths/methods", async () => {
    const { db } = createFakeDb();
    expect(
      await familyMealImageResponse(req("/family/api/inventory"), db, KEY, "pixabay-key"),
    ).toBeUndefined();
    expect(
      await familyMealImageResponse(
        req("/family/api/meal-image", { method: "POST" }),
        db,
        KEY,
        "pixabay-key",
      ),
    ).toBeUndefined();
  });

  it("refuses without a matching key", async () => {
    const { db } = createFakeDb();
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos"),
      db,
      KEY,
      "pixabay-key",
    );
    expect(response!.status).toBe(401);
  });

  it("accepts the family key as a query param, since an <img src> can't carry a custom header", async () => {
    const { db } = createFakeDb(
      [],
      [],
      [{ name_key: "tacos", image_url: "https://cdn.pixabay.com/tacos.jpg", fetched_at: 1 }],
    );
    const response = await familyMealImageResponse(
      req(`/family/api/meal-image?name=Tacos&key=${KEY}`),
      db,
      KEY,
      "pixabay-key",
    );
    expect(response!.status).toBe(302);
  });

  it("404s with no name given", async () => {
    const { db } = createFakeDb();
    const response = await familyMealImageResponse(
      req("/family/api/meal-image", { key: KEY }),
      db,
      KEY,
      "pixabay-key",
    );
    expect(response!.status).toBe(404);
  });

  it("redirects to a cached image URL by normalised name, without calling the search API again", async () => {
    const { db } = createFakeDb(
      [],
      [],
      [
        {
          name_key: "fish and chips",
          image_url: "https://cdn.pixabay.com/fish.jpg",
          fetched_at: 1,
        },
      ],
    );
    let fetchCalled = false;
    const fakeFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response("should not be called", { status: 200 });
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=FISH AND CHIPS", { key: KEY }),
      db,
      KEY,
      "pixabay-key",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/fish.jpg");
    expect(fetchCalled).toBe(false);
  });

  it("404s on a cached miss (a prior search that found nothing) without re-querying", async () => {
    const { db } = createFakeDb(
      [],
      [],
      [{ name_key: "mystery stew", image_url: null, fetched_at: 1 }],
    );
    let fetchCalled = false;
    const fakeFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response("should not be called", { status: 200 });
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Mystery stew", { key: KEY }),
      db,
      KEY,
      "pixabay-key",
      fakeFetch,
    );
    expect(response!.status).toBe(404);
    expect(fetchCalled).toBe(false);
  });

  it("404s without calling Pixabay when no key is configured", async () => {
    const { db } = createFakeDb();
    let fetchCalled = false;
    const fakeFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response("should not be called", { status: 200 });
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos", { key: KEY }),
      db,
      KEY,
      undefined,
      fakeFetch,
    );
    expect(response!.status).toBe(404);
    expect(fetchCalled).toBe(false);
  });

  it("searches Pixabay on a cache miss, restricted to the food category and sorted by popularity, caches the result, and redirects to it", async () => {
    const { db, mealImageRows } = createFakeDb();
    let capturedUrl = "";
    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ hits: [{ webformatURL: "https://cdn.pixabay.com/tacos-640.jpg" }] }),
        { status: 200 },
      );
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(capturedUrl).toBe(
      "https://pixabay.com/api/?key=pixabay-secret&q=Tacos&image_type=photo&category=food&order=popular&safesearch=true&per_page=15",
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/tacos-640.jpg");
    expect(mealImageRows()).toEqual([
      {
        name_key: "tacos",
        image_url: "https://cdn.pixabay.com/tacos-640.jpg",
        fetched_at: expect.any(Number),
      },
    ]);
  });

  it("prefers a hit whose tags explicitly signal a finished dish over an earlier, merely-acceptable one", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: [
            // Not flagged raw/animal, but tags give no positive signal either
            // — a neutral hit that's merely not disqualified.
            { webformatURL: "https://cdn.pixabay.com/neutral.jpg", tags: "pizza, cheese, tomato" },
            // Ranked lower by Pixabay, but its tags explicitly say "baked
            // dinner" — prefer this one.
            {
              webformatURL: "https://cdn.pixabay.com/clearly-cooked.jpg",
              tags: "pizza, baked, dinner",
            },
          ],
        }),
        { status: 200 },
      );
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Pizza", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/clearly-cooked.jpg");
  });

  it("still accepts a neutral (not disqualified) hit when nothing explicitly signals a finished dish, rather than rejecting it", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: [
            { webformatURL: "https://cdn.pixabay.com/neutral.jpg", tags: "pizza, cheese, tomato" },
          ],
        }),
        { status: 200 },
      );
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Pizza", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/neutral.jpg");
  });

  it("skips hits tagged as raw/uncooked/animal and picks the first that looks like a cooked dish", async () => {
    const { db, mealImageRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: [
            {
              webformatURL: "https://cdn.pixabay.com/raw-peppers.jpg",
              tags: "pepper, raw, vegetable",
            },
            {
              webformatURL: "https://cdn.pixabay.com/live-turkey.jpg",
              tags: "turkey, animal, farm",
            },
            {
              webformatURL: "https://cdn.pixabay.com/stuffed-peppers-cooked.jpg",
              tags: "stuffed peppers, dinner, baked",
            },
          ],
        }),
        { status: 200 },
      );
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Stuffed peppers", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe(
      "https://cdn.pixabay.com/stuffed-peppers-cooked.jpg",
    );
    expect(mealImageRows()).toEqual([
      {
        name_key: "stuffed peppers",
        image_url: "https://cdn.pixabay.com/stuffed-peppers-cooked.jpg",
        fetched_at: expect.any(Number),
      },
    ]);
  });

  it("falls back to the first hit (rather than no image) when every hit looks raw/uncooked", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: [
            { webformatURL: "https://cdn.pixabay.com/raw-1.jpg", tags: "raw, ingredient" },
            { webformatURL: "https://cdn.pixabay.com/raw-2.jpg", tags: "fresh produce, market" },
          ],
        }),
        { status: 200 },
      );
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/raw-1.jpg");
  });

  it("doesn't reject a hit over an unrelated word that merely contains a blocked word as a substring", async () => {
    const { db } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: [
            {
              webformatURL: "https://cdn.pixabay.com/farmhouse-pie.jpg",
              tags: "farmhouse pie, dinner",
            },
          ],
        }),
        { status: 200 },
      );
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Pie and mash", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/farmhouse-pie.jpg");
  });

  it("falls back to a generic food search when the meal's own name gets zero hits, so the card still gets a photo", async () => {
    const { db, mealImageRows } = createFakeDb();
    const capturedQueries: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const requestUrl = new URL(String(input));
      const q = requestUrl.searchParams.get("q") ?? "";
      capturedQueries.push(q);
      if (q === "Unicorn stew") {
        return new Response(JSON.stringify({ hits: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ hits: [{ webformatURL: "https://cdn.pixabay.com/generic-dinner.jpg" }] }),
        { status: 200 },
      );
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Unicorn stew", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(capturedQueries).toHaveLength(2);
    expect(capturedQueries[0]).toBe("Unicorn stew");
    expect([
      "home cooked dinner",
      "family meal",
      "comfort food plate",
      "delicious home cooking",
    ]).toContain(capturedQueries[1]);
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/generic-dinner.jpg");
    expect(mealImageRows()).toEqual([
      {
        name_key: "unicorn stew",
        image_url: "https://cdn.pixabay.com/generic-dinner.jpg",
        fetched_at: expect.any(Number),
      },
    ]);
  });

  it("caches a zero-result search (own name and the generic fallback both empty) as no-image, so it isn't re-queried next time", async () => {
    const { db, mealImageRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ hits: [] }), { status: 200 });
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Unicorn stew", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(404);
    expect(mealImageRows()).toEqual([
      { name_key: "unicorn stew", image_url: null, fetched_at: expect.any(Number) },
    ]);
  });

  it("degrades to 404 without caching on a Pixabay API failure, so a transient outage can be retried later", async () => {
    const { db, mealImageRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () => new Response("boom", { status: 500 });
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(404);
    expect(mealImageRows()).toEqual([]);
  });

  it("degrades to 404 without caching on a network error", async () => {
    const { db, mealImageRows } = createFakeDb();
    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Tacos", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(response!.status).toBe(404);
    expect(mealImageRows()).toEqual([]);
  });

  it("still falls back to the generic food search when the meal's own search fails outright (not just zero hits), so a transient hiccup on the specific query doesn't skip the fallback it exists for", async () => {
    const { db, mealImageRows } = createFakeDb();
    const capturedQueries: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const requestUrl = new URL(String(input));
      const q = requestUrl.searchParams.get("q") ?? "";
      capturedQueries.push(q);
      if (q === "Cheese and tomato pizza") {
        return new Response("boom", { status: 500 });
      }
      return new Response(
        JSON.stringify({ hits: [{ webformatURL: "https://cdn.pixabay.com/generic-pizza.jpg" }] }),
        { status: 200 },
      );
    };
    const response = await familyMealImageResponse(
      req("/family/api/meal-image?name=Cheese and tomato pizza", { key: KEY }),
      db,
      KEY,
      "pixabay-secret",
      fakeFetch,
    );
    expect(capturedQueries).toHaveLength(2);
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toBe("https://cdn.pixabay.com/generic-pizza.jpg");
    expect(mealImageRows()).toEqual([
      {
        name_key: "cheese and tomato pizza",
        image_url: "https://cdn.pixabay.com/generic-pizza.jpg",
        fetched_at: expect.any(Number),
      },
    ]);
  });
});
