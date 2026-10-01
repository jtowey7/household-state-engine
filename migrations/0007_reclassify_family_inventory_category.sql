-- The 250 pre-existing items were backfilled by a keyword-only classifier
-- (migration 0006), which gets common cases right but guesses wrong for
-- compound names whose head noun it doesn't recognise — e.g. "Egg
-- tagliatelle" landed in Dairy & eggs via "egg", "Caramelised red onion
-- chutney" landed in Fruit & veg via "onion". Resetting category to NULL
-- here makes the lazy backfill in familyInventoryApiResponse (GET) run
-- again on next load, this time through the AI classifier added
-- alongside this migration, which actually understands what these
-- products are rather than pattern-matching on one word in the name.

UPDATE family_inventory SET category = NULL;
