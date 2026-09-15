import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "../operator-read-auth";
import { resolveAirtableConfig } from "../production-adapter/airtable-rest-source";
import { toMealPlanRows } from "./persist";
import type { MealPlanDraftRow } from "./types";

const AIRTABLE_API_URL = "https://api.airtable.com";
const TABLE = "MEAL PLANS";

type WorkerEnvironment = Record<string, string | undefined>;

function readEnvironment(): WorkerEnvironment {
  const processEnv = typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>);
  return { ...processEnv };
}

function airtableUrl(baseId: string): string {
  return `${AIRTABLE_API_URL}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(TABLE)}`;
}

/**
 * Live selected-week persistence. This is deliberately separate from the
 * read-only production connector: it writes only explicitly selected planned
 * meal rows, never stock, consumption, shopping or delivery state.
 */
export const persistSelectedWeekLive = createServerFn({ method: "POST" })
  .validator((data: { rows: readonly MealPlanDraftRow[] }) => data)
  .handler(async ({ data }) => {
    const env = readEnvironment();
    const auth = await authorizeOperatorSession(
      new Request("https://foodos.local/runtime/operator/meal-plan", {
        method: "POST",
        headers: { cookie: getRequestHeader("cookie") ?? "" },
      }),
      env,
    );
    if (auth) return { ok: false as const, reason: "Connect to your household before saving a week." };

    if (!Array.isArray(data.rows) || data.rows.length === 0) {
      return { ok: false as const, reason: "Choose at least one meal before saving the week." };
    }
    if (data.rows.length > 7) {
      return { ok: false as const, reason: "A week can hold at most seven meals." };
    }

    const resolution = resolveAirtableConfig(env);
    if (resolution.status !== "CONFIGURED") {
      return { ok: false as const, reason: "FoodOS is not connected to the household planning store yet." };
    }

    const records = data.rows.map((row) => ({
      fields: {
        Meal: row.Meal,
        Date: row.Date,
        "Meal type": row["Meal type"],
        "Why this meal": row["Why this meal"],
        Status: row.Status,
        "Record class": row["Record class"],
      },
    }));

    try {
      const response = await fetch(airtableUrl(resolution.config.baseId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolution.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ records, typecast: false }),
      });
      if (!response.ok) {
        return { ok: false as const, reason: "FoodOS could not save this week. Nothing has been changed." };
      }
      const payload = (await response.json()) as { records?: Array<{ id?: unknown }> };
      const ids = Array.isArray(payload.records)
        ? payload.records.map((record) => record.id).filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length !== records.length) {
        return { ok: false as const, reason: "FoodOS could not verify the saved week. Nothing has been accepted as saved." };
      }
      setResponseHeader("Cache-Control", "no-store");
      return { ok: true as const, persistedMealCount: ids.length, ids, stockEffects: 0 as const };
    } catch {
      return { ok: false as const, reason: "FoodOS could not save this week. Nothing has been changed." };
    }
  });

export function selectedRowsForLivePersistence(
  selected: Parameters<typeof toMealPlanRows>[0],
): MealPlanDraftRow[] {
  return toMealPlanRows(selected);
}
