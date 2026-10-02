-- Caches a meal name -> photo URL lookup against the free Pexels search
-- API, keyed by normalised meal name. Since this household's dinners are
-- mostly repeat favourites (spaghetti bolognese, fish and chips, ...),
-- caching keeps real API calls rare after the first few weeks, well
-- inside Pexels' free tier. image_url is nullable: a successful search
-- with zero results is cached too, so a meal name that genuinely has no
-- good match doesn't get re-queried every time it comes up.

CREATE TABLE IF NOT EXISTS meal_image_cache (
  name_key TEXT PRIMARY KEY,
  image_url TEXT,
  fetched_at INTEGER NOT NULL
);
