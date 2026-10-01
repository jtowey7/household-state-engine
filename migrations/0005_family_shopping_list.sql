-- Persistent shopping list: once "Plan the week" proposes items to buy,
-- they need to survive until they actually arrive — which can be days
-- after ordering, and on a different device than the one that ordered
-- them. Rows stay 'pending' until the household marks them 'arrived'
-- (after which the item is also added to family_inventory) or
-- 'cancelled' (decided not to buy it after all).

CREATE TABLE IF NOT EXISTS family_shopping_list (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  quantity TEXT,
  direct_url TEXT,
  direct_product_name TEXT,
  direct_verified_on TEXT,
  search_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_family_shopping_list_status ON family_shopping_list (status);
