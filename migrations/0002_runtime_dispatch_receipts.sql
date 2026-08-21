-- Food OS owned-runtime synthetic dispatch receipt state only.
-- Production retailer I/O and production household tables remain deliberately absent.

CREATE TABLE IF NOT EXISTS runtime_dispatch_receipts (
  dispatch_id TEXT PRIMARY KEY,
  basket_id TEXT NOT NULL,
  basket_version INTEGER NOT NULL,
  basket_fingerprint TEXT NOT NULL,
  retailer TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'ACCEPTED'),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_dispatch_receipts_basket
  ON runtime_dispatch_receipts(basket_id);
