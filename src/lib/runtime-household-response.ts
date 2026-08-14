import type { HouseholdEvent } from "./state-engine/types";
import { appendTestHouseholdEvent, readTestHouseholdState } from "./runtime-household";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: () => Promise<{ results: unknown[]; success: boolean; meta?: { changes?: number } }>;
  run: () => Promise<{ results: unknown[]; success: boolean; meta?: { changes?: number } }>;
};

type D1DatabaseLike = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

function isHouseholdEvent(value: unknown): value is HouseholdEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === "string" &&
    event.recordClass === "Test" &&
    (event.eventType === "ITEM_STOCK_SET" ||
      event.eventType === "ITEM_STOCK_DELTA" ||
      event.eventType === "ITEM_REMOVED") &&
    typeof event.itemKey === "string" &&
    typeof event.occurredAt === "string" &&
    typeof event.payload === "object" &&
    event.payload !== null
  );
}

/**
 * Synthetic-only family-alpha state endpoints.
 * Production household writes are deliberately rejected at the HTTP boundary.
 */
export async function runtimeHouseholdResponse(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/runtime/household/state" && request.method === "GET") {
    try {
      const result = await readTestHouseholdState(db);
      return Response.json({
        ok: true,
        mode: "TEST_ONLY",
        eventCount: result.eventCount,
        snapshot: result.snapshot,
      });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Household state replay failed" }, { status: 500 });
    }
  }

  if (url.pathname === "/runtime/household/events" && request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!isHouseholdEvent(body)) {
      return Response.json(
        {
          ok: false,
          error: "Only well-formed Record class = Test household events are accepted by the runtime alpha boundary",
        },
        { status: 400 },
      );
    }

    try {
      const result = await appendTestHouseholdEvent(db, body);
      return Response.json({
        ok: true,
        mode: "TEST_ONLY",
        appended: result.appended,
        duplicate: result.duplicate,
        conflict: result.conflict,
        eventId: result.eventId,
        snapshot: result.snapshot,
      });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: "Household event append failed" }, { status: 500 });
    }
  }

  return undefined;
}
