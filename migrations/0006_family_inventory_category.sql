-- Supermarket-aisle category for grouping the inventory list. Populated by
-- a free, local keyword classifier (src/lib/family-inventory/categorise.ts)
-- at add/rename time — never an AI call. Existing rows get backfilled
-- lazily the next time the inventory is loaded (see familyInventoryApiResponse),
-- not by this migration, since the classification logic lives in TS.

ALTER TABLE family_inventory ADD COLUMN category TEXT;
