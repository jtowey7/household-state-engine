-- Standing household defaults for meal planning (household size, dietary
-- constraints, spice preference), baked into every plan-meal prompt as the
-- baseline so nobody has to retype them. A single shared row — every phone
-- in the house sees the same defaults, edited via /family/api/preferences.
CREATE TABLE IF NOT EXISTS family_preferences (
  id TEXT PRIMARY KEY,
  people_count INTEGER NOT NULL,
  dietary_notes TEXT,
  spice_level TEXT,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO family_preferences (id, people_count, dietary_notes, spice_level, updated_at)
VALUES ('default', 6, NULL, NULL, 0);
