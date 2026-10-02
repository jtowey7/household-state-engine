-- Third round: the cache now holds several specific bad results the user
-- flagged directly (a bowl of raw peppers for "stuffed peppers", a spoonful
-- of beetroot paste for "beetroot salad", a fried-fish photo for "chicken
-- and bacon pies") from before the tag-based cooked/raw filter existed.
-- Clear again so those meals get re-searched under the new logic, which
-- inspects each candidate's own Pixabay tags rather than blindly trusting
-- whatever ranked first.
DELETE FROM meal_image_cache;
