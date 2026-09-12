import { replayEvents } from "./state-engine";
import type { HouseholdEvent, StateSnapshot } from "./state-engine/types";
import { hashOf } from "./state-engine/hash";

export type D1Result = { results: unknown[]; success: boolean; meta?: { changes?: number } };
export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: () => Promise<D1Result>;
  run: () => Promise<D1Result>;
};
export type D1DatabaseLike = {
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

async function ensureTestSchema(db: D1DatabaseLike): Promise<void> {
  // The runtime test database is intentionally self-initialising because the
  // deployment token is scoped to Worker deployment and does not have D1
  // import/write permissions. This schema is TEST-only and contains no
  // production household tables.
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS runtime_household_events (
         sequence INTEGER PRIMARY KEY AUTOINCREMENT,
         event_id TEXT NOT NULL,
         event_type TEXT NOT NULL CHECK (event_type IN ('ITEM_STOCK_SET', 'ITEM_STOCK_DELTA', 'ITEM_REMOVED')),
         item_key TEXT NOT NULL,
         occurred_at TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         supersedes_json TEXT NOT NULL,
         event_hash TEXT NOT NULL,
         recorded_at INTEGER NOT NULL,
         record_class TEXT NOT NULL DEFAULT 'Test' CHECK (record_class = 'Test')
       )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_runtime_household_events_event_id
       ON runtime_household_events(event_id)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_runtime_household_events_item
       ON runtime_household_events(item_key, sequence)`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS runtime_household_snapshots (
         snapshot_id TEXT PRIMARY KEY,
         replay_id TEXT NOT NULL,
         replay_timestamp TEXT NOT NULL,
         reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('CLEAN', 'EXCEPTIONS', 'BLOCKED')),
         event_count INTEGER NOT NULL,
         snapshot_json TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_runtime_household_snapshots_created
       ON runtime_household_snapshots(created_at)`,
    ),
  ]);
}

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
    eventId: String(row['event_id']),
    recordClass: "Production",
    eventType: String(row['event_type']) as HouseholdEvent["eventType"],
    itemKey: String(row['item_key']),
    occurredAt: String(row['occurred_at']),
    payload: JSON.parse(String(row['payload_json'])) as HouseholdEvent["payload"],
    supersedes: JSON.parse(String(row['supersedes_json'])) as string[],
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

  await ensureTestSchema(db);

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

  if (duplicate || conflict) {
    const events = await readEvents(db);
    // A conflicting reuse must be visible as a BLOCKED replay exception even
    // though the conflicting event is deliberately not persisted. Replay the
    // candidate only in memory so the durable ledger remains unchanged while
    // the returned evidence accurately represents the rejected input.
    const replayInput = conflict
      ? [...events, { ...event, recordClass: "Production" as const }]
      : events;
    const snapshot = replayEvents(replayInput);
    await persistSnapshot(db, snapshot, events.length);
    return {
      appended: false,
      duplicate,
      conflict,
      eventId: event.eventId,
      snapshot,
    };
  }

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
    duplicate: false,
    conflict: false,
    eventId: event.eventId,
    snapshot,
  };
}

export async function resetTestHouseholdState(db: D1DatabaseLike): Promise<void> {
  await ensureTestSchema(db);
  await db.batch([
    db.prepare("DELETE FROM runtime_household_snapshots"),
    db.prepare("DELETE FROM runtime_household_events"),
  ]);
}

export async function readTestHouseholdState(
  db: D1DatabaseLike,
): Promise<RuntimeHouseholdStateResult> {
  await ensureTestSchema(db);
  const events = await readEvents(db);
  const snapshot = replayEvents(events);
  await persistSnapshot(db, snapshot, events.length);
  return { snapshot, eventCount: events.length };
}
