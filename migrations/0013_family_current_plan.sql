-- Persists the most recently generated meal plan (ready meals + "almost
-- there" meals) as a single shared row, the same pattern as
-- family_preferences — whichever phone last hit "What can we eat?", every
-- phone in the house sees that plan until it's refreshed or a meal is
-- marked cooked. Previously the plan lived only in a page-local JS
-- variable, so closing a tab or reloading lost it entirely, and
-- regenerating could return a different plan from the same stock.
CREATE TABLE IF NOT EXISTS family_current_plan (
  id TEXT PRIMARY KEY,
  plan_text TEXT,
  meals_json TEXT NOT NULL,
  almost_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
