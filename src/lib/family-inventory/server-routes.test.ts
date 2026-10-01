import { describe, expect, it } from "vitest";
import {
  familyPageResponse,
  familyInventoryApiResponse,
  familyPlanMealResponse,
  extractShoppingList,
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

function createFakeDb(initialRows: FakeRow[] = []): { db: D1DatabaseLike; rows: () => FakeRow[] } {
  let rows = [...initialRows];
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
          throw new Error(`Unhandled statement in fake db: ${sql}`);
        },
      };
      return statement;
    },
  };
  return { db, rows: () => rows };
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
    expect(sentBody.messages[0]!.content).toContain("Freezer 2 (outside)");

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
      shoppingList: { item: string; directUrl: string | null; searchUrl: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.plan).toBe("Mon: spag bol.");
    expect(body.shoppingList).toHaveLength(1);
    expect(body.shoppingList[0]!.item).toBe("beef mince");
    expect(body.shoppingList[0]!.directUrl).toContain("tesco.com/shop/en-GB/products/");
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
