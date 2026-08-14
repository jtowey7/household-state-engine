import { replayEvents } from "./state-engine";
import type { HouseholdEvent, StateSnapshot } from "./state-engine/types";
import { hashOf } from "./state-engine/hash";

type D1Result = { results: unknown[]; success: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: () => Promise<D1Result>;
  run: () => Promise<D1Result>;
};
type D1DatabaseLike = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<D1Result[]>;
};

export type RuntimeHouseholdEventResult = {
  appended: boolean;
  duplicate: boolean;
  conflict: boolean;
  eventId: string;
  snapshot: StateSnapshot;
};

export type RuntimeHouseholdStateResult = {
  snapshot: StateSnapshot;
  eventCount: number;
};

function eventIdentity(event: HouseholdEvent): string {
  return hashOf({
    recordClass: event.recordClass,
    eventType: event.eventType,
    itemKey: event.itemKey,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
    supersedes: [...(event.supersedes ?? [])].sort(),
  });
}

function toEvent(row: Record<string, unknown>): HouseholdEvent {
  // The D1 tables are physically isolated TEST storage. Replay the stored
  // fixture as a production-shaped event so the real state-engine semantics
  // are exercised without granting the runtime any production write path.
  return {
    eventId: String(row.event_id),
    recordClass: "Production",
    eventType: String(row.event_type) as HouseholdEvent["eventType"],
    itemKey: String(row.item_key),
    occurredAt: String(row.occurred_at),
    payload: JSON.parse(String(row.payload_json)) as HouseholdEvent["payload"],
    supersedes: JSON.parse(String(row.supersedes_json)) as string[],
  };
}

async function readEvents(db: D1DatabaseLike): Promise<HouseholdEvent[]> {
  const result = await db
    .prepare(
      `SELECT event_id, event_type, item_key, occurred_at, payload_json, supersedes_json
       FROM runtime_household_events
       ORDER BY sequence ASC`,
    )
    .all();

  return result.results.map((row) => toEvent(row as Record<string, unknown>));
}

async function persistSnapshot(
  db: D1DatabaseLike,
  snapshot: StateSnapshot,
  eventCount: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO runtime_household_snapshots
         (snapshot_id, replay_id, replay_timestamp, reconciliation_status, event_count, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      snapshot.snapshotId,
      snapshot.replayId,
      snapshot.replayTimestamp,
      snapshot.reconciliationStatus,
      eventCount,
      JSON.stringify(snapshot),
      Date.now(),
    )
    .run();
}

export async function appendTestHouseholdEvent(
  db: D1DatabaseLike,
  event: HouseholdEvent,
): Promise<RuntimeHouseholdEventResult> {
  if (event.recordClass !== "Test") {
    throw new Error("Runtime household adapter accepts Test events only");
  }

  const identity = eventIdentity({ ...event, recordClass: "Production" });
  const existing = await db
    .prepare(
      `SELECT event_hash
       FROM runtime_household_events
       WHERE event_id = ?
       ORDER BY sequence ASC`,
    )
    .bind(event.eventId)
    .all();

  const hashes = existing.results.map((row) => String((row as { event_hash: string }).event_hash));
  const duplicate = hashes.includes(identity);
  const conflict = hashes.length > 0 && !duplicate;

  await db
    .prepare(
      `INSERT INTO runtime_household_events
         (event_id, event_type, item_key, occurred_at, payload_json, supersedes_json, event_hash, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.eventId,
      event.eventType,
      event.itemKey,
      event.occurredAt,
      JSON.stringify(event.payload ?? {}),
      JSON.stringify([...(event.supersedes ?? [])].sort()),
      identity,
      Date.now(),
    )
    .run();

  const events = await readEvents(db);
  const snapshot = replayEvents(events);
  await persistSnapshot(db, snapshot, events.length);

  return {
    appended: true,
    duplicate,
    conflict,
    eventId: event.eventId,
    snapshot,
  };
}

export async function readTestHouseholdState(
  db: D1DatabaseLike,
): Promise<RuntimeHouseholdStateResult> {
  const events = await readEvents(db);
  const snapshot = replayEvents(events);
  await persistSnapshot(db, snapshot, events.length);
  return { snapshot, eventCount: events.length };
}
