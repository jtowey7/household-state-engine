import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "./operator-read-auth";

const INVENTORY_TABLE_ID = "tblN5ZnsivyfIQKnE";
const INVENTORY_FIELDS = [
  "Item",
  "Category",
  "Location",
  "Quantity",
  "Unit",
  "Status",
  "Best before",
  "Notes",
  "Source / Supermarket",
  "Delivered",
] as const;

async function runtimeEnvironment(): Promise<Record<string, string | undefined>> {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
      if (typeof value === "string") cloudflareEnv[key] = value;
    }
  } catch {
    // Local/test execution falls back to process.env below.
  }
  return {
    ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)),
    ...cloudflareEnv,
  };
}

export interface OperatorInventoryItem {
  id: string;
  item: string;
  category: string;
  location: string;
  quantity: number | null;
  unit: string;
  status: string;
  bestBefore: string | null;
  notes: string;
  source: string;
  delivered: string | null;
}

export type OperatorInventoryResponse =
  | {
      ok: true;
      items: OperatorInventoryItem[];
      source: "PRODUCTION_INVENTORY";
      readOnly: true;
    }
  | {
      ok: false;
      error: string;
      detail: string;
      status: "NOT_READY";
    };

export const getOperatorInventory = createServerFn({ method: "GET" }).handler(async (): Promise<OperatorInventoryResponse> => {
  const env = await runtimeEnvironment();
  const authorization = await authorizeOperatorSession(
    new Request("https://foodos.local/runtime/operator/inventory", {
      method: "GET",
      headers: { cookie: getRequestHeader("cookie") ?? "" },
    }),
    env,
  );

  if (authorization) {
    setResponseStatus(authorization.status);
    return (await authorization.json()) as OperatorInventoryResponse;
  }

  const baseId = env.AIRTABLE_FOOD_OS_BASE_ID;
  const credential = env.AIRTABLE_API_KEY;
  if (!baseId || !credential) {
    setResponseStatus(503);
    return {
      ok: false,
      error: "Production inventory read is not configured",
      detail: "FoodOS could not connect to the household inventory; no local or synthetic stock was substituted.",
      status: "NOT_READY",
    };
  }

  const url = new URL(
    `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(INVENTORY_TABLE_ID)}`,
  );
  url.searchParams.set("pageSize", "100");
  for (const field of INVENTORY_FIELDS) url.searchParams.append("fields[]", field);

  const items: OperatorInventoryItem[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    if (offset) url.searchParams.set("offset", offset);
    else url.searchParams.delete("offset");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      setResponseStatus(response.status === 401 || response.status === 403 ? 502 : 503);
      return {
        ok: false,
        error: "Production inventory read failed",
        detail: `Airtable returned ${response.status}: ${body}`,
        status: "NOT_READY",
      };
    }

    const payload = (await response.json()) as {
      records?: Array<{ id?: unknown; fields?: Record<string, unknown> }>;
      offset?: unknown;
    };
    if (!Array.isArray(payload.records)) {
      setResponseStatus(502);
      return {
        ok: false,
        error: "Production inventory read was incomplete",
        detail: "Airtable returned no records array; FoodOS refused to substitute another stock source.",
        status: "NOT_READY",
      };
    }

    for (const record of payload.records) {
      const fields = record.fields ?? {};
      const id = typeof record.id === "string" ? record.id : "";
      if (!id) {
        setResponseStatus(502);
        return {
          ok: false,
          error: "Production inventory read was incomplete",
          detail: "An inventory record had no stable record identity; FoodOS refused a partial read.",
          status: "NOT_READY",
        };
      }
      const quantity = typeof fields.Quantity === "number" ? fields.Quantity : null;
      items.push({
        id,
        item: typeof fields.Item === "string" ? fields.Item : "Unnamed item",
        category: typeof fields.Category === "string" ? fields.Category : "Other",
        location: typeof fields.Location === "string" ? fields.Location : "Other",
        quantity,
        unit: typeof fields.Unit === "string" ? fields.Unit : "",
        status: typeof fields.Status === "string" ? fields.Status : "",
        bestBefore: typeof fields["Best before"] === "string" ? fields["Best before"] : null,
        notes: typeof fields.Notes === "string" ? fields.Notes : "",
        source: typeof fields["Source / Supermarket"] === "string" ? fields["Source / Supermarket"] : "",
        delivered: typeof fields.Delivered === "string" ? fields.Delivered : null,
      });
    }

    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) break;
  }

  if (offset) {
    setResponseStatus(502);
    return {
      ok: false,
      error: "Production inventory read was too large",
      detail: "FoodOS refused a partial inventory read after 50 Airtable pages.",
      status: "NOT_READY",
    };
  }

  items.sort((a, b) => `${a.location}\u0000${a.category}\u0000${a.item}`.localeCompare(`${b.location}\u0000${b.category}\u0000${b.item}`));
  setResponseHeader("Cache-Control", "private, no-store");
  return { ok: true, items, source: "PRODUCTION_INVENTORY", readOnly: true };
});
