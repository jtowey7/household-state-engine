-- Food OS owned-runtime synthetic state only.
-- Production household tables are deliberately absent from this migration.

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

INSERT OR IGNORE INTO runtime_tasks
  (task_id, status, task_class, directive, updated_at)
VALUES
  ('CLOUDFLARE-01-SYNTHETIC', 'READY', 'TEST', 'Execute the minimum owned-runtime proof against synthetic state only.', strftime('%s','now') * 1000);
