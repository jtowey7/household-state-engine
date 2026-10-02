-- meal_image_cache is checked before any Pixabay search runs, so a meal
-- name cached under the old (pre-category=food, no-generic-fallback) logic
-- just keeps re-serving its old result forever, even after the search
-- logic itself is fixed. That's why the live-turkey photo for "Roasted
-- turkey joint dinner" survived two rounds of search fixes, and why some
-- meals were still showing no photo at all (cached as a null "no match").
-- Clear every cached entry so each meal gets re-searched, once, under the
-- current logic (category=food, generic food fallback on a zero-hit
-- search) the next time its card is shown.
DELETE FROM meal_image_cache;
