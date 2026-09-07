/**
 * FoodOS — CURRENT HOUSEHOLD WEEK SELECTION.
 *
 * Pure, deterministic selection of the household week (Monday 00:00 to the
 * following Monday 00:00, household time zone) that contains a given instant,
 * plus stale-plan exclusion for Production MEAL PLANS rows.
 *
 * This module holds no connector, proposes no events and cannot express a
 * Production household mutation. Rows outside the current week are excluded
 * rather than reinterpreted, so an August plan can never masquerade as this
 * week's plan.
 */

export const HOUSEHOLD_TIME_ZONE = "Europe/London";

export interface HouseholdWeekWindow {
  /** Inclusive UTC instant of local Monday 00:00. */
  startIso: string;
  /** Exclusive UTC instant of the following local Monday 00:00. */
  endIso: string;
  timeZone: string;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(read("hour"));

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: WEEKDAYS[read("weekday")] ?? 1,
  };
}

/** UTC instant for a wall-clock local time in the given zone. */
function fromLocalMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = new Date(guess);
  for (let pass = 0; pass < 3; pass += 1) {
    const local = localParts(instant, timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const offset = localAsUtc - instant.getTime();
    const next = new Date(guess - offset);
    if (next.getTime() === instant.getTime()) return instant;
    instant = next;
  }
  return instant;
}

/** The Monday-to-Monday household week containing `nowIso`. */
export function resolveCurrentWeekWindow(
  nowIso: string,
  timeZone: string = HOUSEHOLD_TIME_ZONE,
): HouseholdWeekWindow {
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid current instant: ${nowIso}`);

  const local = localParts(now, timeZone);
  const mondayUtcDay = Date.UTC(local.year, local.month - 1, local.day) - (local.weekday - 1) * 86_400_000;
  const monday = new Date(mondayUtcDay);
  const start = fromLocalMidnight(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    timeZone,
  );
  const nextMonday = new Date(mondayUtcDay + 7 * 86_400_000);
  const end = fromLocalMidnight(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
    timeZone,
  );

  return { startIso: start.toISOString(), endIso: end.toISOString(), timeZone };
}

/** True when a MEAL PLANS date falls inside the current household week. */
export function isWithinWeekWindow(dateValue: unknown, window: HouseholdWeekWindow): boolean {
  if (typeof dateValue !== "string" || !dateValue.trim()) return false;
  // Date-only Airtable values are household-local dates.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())
    ? fromLocalMidnight(
        Number(dateValue.slice(0, 4)),
        Number(dateValue.slice(5, 7)),
        Number(dateValue.slice(8, 10)),
        window.timeZone,
      ).toISOString()
    : dateValue;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return at >= new Date(window.startIso).getTime() && at < new Date(window.endIso).getTime();
}

export interface WeekRowSelection<T> {
  /** Rows dated inside the current household week, chronologically ordered. */
  current: T[];
  /** Rows excluded because they belong to another week or carry no usable date. */
  excludedCount: number;
}

/**
 * Select only the current household week's rows. Rows from earlier or later
 * weeks are excluded, never re-dated, and never used to fill the week.
 */
export function selectCurrentWeekRows<T>(
  rows: readonly T[],
  window: HouseholdWeekWindow,
  dateOf: (row: T) => unknown,
): WeekRowSelection<T> {
  const current = rows
    .filter((row) => isWithinWeekWindow(dateOf(row), window))
    .sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))));
  return { current, excludedCount: rows.length - current.length };
}
