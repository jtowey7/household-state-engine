-- Second round: now that the fallback-skip bug is fixed (a search failure
-- on the specific meal name no longer bypasses the generic fallback) and
-- photoQuery is abstracted to a recognisable umbrella dish term rather than
-- the full compound recipe, clear the cache again so every meal gets
-- re-searched under the current logic rather than keeping whatever image
-- (or lack of one) was cached during the window those bugs were still live.
DELETE FROM meal_image_cache;
