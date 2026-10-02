-- The 72 "What you'll need" items waiting were legacy cruft: the old
-- shopping-list behaviour (before the "unlock more meals" redesign) used to
-- silently queue up to 12 items on every single plan request, so pending
-- counts crept up with nothing the household had actually chosen. Marking
-- them cancelled clears the active list (the same transition "Not getting
-- this" already uses) while keeping the history rather than deleting rows.
UPDATE family_shopping_list
SET status = 'cancelled', resolved_at = strftime('%s', 'now') * 1000
WHERE status = 'pending';
