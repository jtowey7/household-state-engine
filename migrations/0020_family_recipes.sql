-- Favorite recipes: a household-customized version of a meal, saved once
-- from a suggested meal card (or written from scratch) so it can be added
-- straight back onto the plan later without asking the model again — and
-- so the model itself knows to stop suggesting a generic version of a dish
-- the household has already corrected (e.g. "carbonara" made with cheddar
-- and egg, not cream and parmesan).
CREATE TABLE IF NOT EXISTS family_recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT 'moderate',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
