-- Meal photos are gone: a live third-party image search (Pixabay) kept
-- failing in ways nobody could see coming (rate limits, zero-hit misses,
-- wrong photos) across six-plus "fix" rounds, so the app now uses a fixed
-- local food-category icon per meal instead — no live lookup, no cache,
-- nothing that can go blank. The cache table this search used is dead.
DROP TABLE IF EXISTS meal_image_cache;
