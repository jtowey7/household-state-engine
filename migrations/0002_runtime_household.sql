-- Food OS owned-runtime synthetic household state only.
-- These tables are deliberately TEST-only and are not production household state.

CREATE TABLE IF NOT EXISTS runtime_household_events (
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
);

CREATE INDEX IF NOT EXISTS idx_runtime_household_events_event_id
  ON runtime_household_events(event_id);
CREATE INDEX IF NOT EXISTS idx_runtime_household_events_item
  ON runtime_household_events(item_key, sequence);

CREATE TABLE IF NOT EXISTS runtime_household_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  replay_id TEXT NOT NULL,
  replay_timestamp TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('CLEAN', 'EXCEPTIONS', 'BLOCKED')),
  event_count INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_household_snapshots_created
  ON runtime_household_snapshots(created_at);
