-- Fourth round, on request: clear the cache again so every meal is
-- re-searched fresh under the current logic (category=food, generic
-- fallback, raw/animal tag filtering, finished-dish tag preference).
DELETE FROM meal_image_cache;
