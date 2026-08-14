-- Idempotent non-production schema guard used by the Cloudflare runtime proof.
-- Production household tables are deliberately absent.

CREATE TABLE IF NOT EXISTS runtime_tasks (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('READY', 'CLAIMED', 'COMPLETE')),
  task_class TEXT NOT NULL CHECK (task_class IN ('TEST', 'PRODUCTION')),
  directive TEXT NOT NULL,
  claimed_by TEXT,
  claim_run_id TEXT,
  lease_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_claims (
  claim_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES runtime_tasks(task_id),
  run_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  evidence TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_claims_task ON runtime_claims(task_id);
CREATE INDEX IF NOT EXISTS idx_runtime_claims_lease ON runtime_claims(lease_expires_at);

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

INSERT OR IGNORE INTO runtime_tasks
  (task_id, status, task_class, directive, updated_at)
VALUES
  ('CLOUDFLARE-01-SYNTHETIC', 'READY', 'TEST', 'Execute the minimum owned-runtime proof against synthetic state only.', strftime('%s','now') * 1000);
