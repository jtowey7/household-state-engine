/**
 * Strict read-only mapper for the real Airtable MEAL PLANS field contract.
 *
 * This adapter only shapes source rows. It does not fetch, create or update
 * Airtable records and it never infers servings from household size or recipe
 * defaults. Production demand remains blocked until the People links are
 * explicit and valid.
 */
import type {
  ProductionMealDemandInput,
  ProductionMealDemandRejection,
  ProductionMealPlanRow,
} from "./production-meal-input";
import { buildProductionMealDemand } from "./production-meal-input";

export interface AirtableMealPlanRow {
  /** Airtable record id; used only as the meal-plan identity. */
  id: string;
  fields: Record<string, unknown>;
}

/** Exact fields consumed from the real MEAL PLANS table. */
export const MEAL_PLAN_FIELDS = [
  "Meal",
  "Date",
  "Meal type",
  "Vegetarian provision",
  "Method",
  "Why this meal",
  "Leftovers",
  "Status",
  "People",
  "Recipe",
  "SHOPPING",
  "PREFERENCES",
  "QUANTITY REQUIREMENTS",
  "Record class",
] as const;

/** Field names from older/invented meal-plan contracts that must not be accepted. */
export const LEGACY_MEAL_PLAN_FIELDS = [
  "Recipe ID",
  "Servings",
  "Serving count",
  "Household size",
] as const;

export type MealPlanRowRejectionCode =
  | "LEGACY_FIELD_SCHEMA"
  | "MISSING_MEAL_ID"
  | "INVALID_RECORD_CLASS"
  | "MISSING_RECIPE"
  | "AMBIGUOUS_RECIPE"
  | "MISSING_SERVING_INPUT"
  | "INVALID_SERVING_INPUT";

export interface AirtableMealPlanMappingRejection {
  mealPlanId: string | null;
  code: MealPlanRowRejectionCode;
  detail: string;
}

export type AirtableMealPlanMapping =
  | { ok: true; row: ProductionMealPlanRow }
  | { ok: false; rejection: AirtableMealPlanMappingRejection };

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function linkedRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object" && "id" in entry) {
        const id = (entry as { id?: unknown }).id;
        return typeof id === "string" ? id.trim() : "";
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * Map one real Airtable MEAL PLANS row into the strict production input shape.
 * Missing/ambiguous links are explicit rejections; nothing is inferred.
 */
export function mapAirtableMealPlanRow(row: AirtableMealPlanRow): AirtableMealPlanMapping {
  const fields = row.fields ?? {};
  const mealPlanId = nonEmptyString(row.id);
  if (!mealPlanId) {
    return {
      ok: false,
      rejection: {
        mealPlanId: null,
        code: "MISSING_MEAL_ID",
        detail: "Airtable MEAL PLANS row has no record id; meal identity is required.",
      },
    };
  }

  const legacy = LEGACY_MEAL_PLAN_FIELDS.filter((name) => name in fields);
  if (legacy.length > 0) {
    return {
      ok: false,
      rejection: {
        mealPlanId,
        code: "LEGACY_FIELD_SCHEMA",
        detail: `Row contains legacy/invented serving fields (${legacy.join(", ")}); the real People links remain authoritative.`,
      },
    };
  }

  const recordClass = nonEmptyString(fields["Record class"]);
  if (recordClass !== "Production" && recordClass !== "Test") {
    return {
      ok: false,
      rejection: {
        mealPlanId,
        code: "INVALID_RECORD_CLASS",
        detail: `Record class must be Production or Test, received "${recordClass ?? ""}".`,
      },
    };
  }

  const recipeLinks = linkedRecordIds(fields["Recipe"]);
  if (recipeLinks.length === 0) {
    return {
      ok: false,
      rejection: {
        mealPlanId,
        code: "MISSING_RECIPE",
        detail: "Production meal has no linked Recipe record.",
      },
    };
  }
  if (recipeLinks.length !== 1) {
    return {
      ok: false,
      rejection: {
        mealPlanId,
        code: "AMBIGUOUS_RECIPE",
        detail: `Meal links to ${recipeLinks.length} Recipe records; exactly one is required.`,
      },
    };
  }

  const people = linkedRecordIds(fields["People"]);
  if (recordClass === "Production" && people.length === 0) {
    return {
      ok: false,
      rejection: {
        mealPlanId,
        code: "MISSING_SERVING_INPUT",
        detail: "Production meal has no People links; servings cannot be inferred.",
      },
    };
  }

  const mapped: ProductionMealPlanRow = {
    mealPlanId,
    recipeId: recipeLinks[0],
    people,
    recordClass,
  };
  return { ok: true, row: mapped };
}

/**
 * Map a batch of Airtable-shaped rows and then apply the strict serving-input
 * contract. Test rows are retained as mapped input but ignored by the demand
 * builder. Rejections are deterministic and sorted by meal-plan identity.
 */
export function buildProductionMealDemandFromAirtable(
  rows: readonly AirtableMealPlanRow[],
): ProductionMealDemandInput & { sourceRejections: AirtableMealPlanMappingRejection[] } {
  const sourceRejections: AirtableMealPlanMappingRejection[] = [];
  const mappedRows: ProductionMealPlanRow[] = [];

  for (const row of rows) {
    const mapped = mapAirtableMealPlanRow(row);
    if (!mapped.ok) {
      sourceRejections.push(mapped.rejection);
      continue;
    }
    mappedRows.push(mapped.row);
  }

  const demand = buildProductionMealDemand(mappedRows);
  const rejections: ProductionMealDemandRejection[] = [
    ...sourceRejections
      .filter((rejection) => rejection.code === "MISSING_SERVING_INPUT" || rejection.code === "INVALID_SERVING_INPUT")
      .map((rejection) => ({
        mealPlanId: rejection.mealPlanId!,
        code: rejection.code,
        detail: rejection.detail,
      })),
    ...demand.rejections,
  ];

  rejections.sort((a, b) => a.mealPlanId.localeCompare(b.mealPlanId));
  sourceRejections.sort((a, b) => (a.mealPlanId ?? "").localeCompare(b.mealPlanId ?? ""));
  return { meals: demand.meals, rejections, sourceRejections };
}
