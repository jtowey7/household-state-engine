-- Fifth round, on request: clear the cache again now that a cached "no
-- image found" result expires after an hour instead of sticking forever,
-- so any photo stuck on a stale permanent miss from this session's heavy
-- testing gets a fresh, immediate try rather than waiting for its own
-- expiry.
DELETE FROM meal_image_cache;
