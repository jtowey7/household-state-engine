-- Shopping list items now group by the dinner each purchase would
-- unlock (e.g. "beef mince" -> "Beef burgers"), rather than being a flat
-- ingredient dump disconnected from why you're buying it. Nullable: rows
-- already pending before this migration simply have no meal label and
-- render under an "Other" group until resolved.

ALTER TABLE family_shopping_list ADD COLUMN meal TEXT;
