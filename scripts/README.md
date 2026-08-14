# FoodOS development scripts

## `build-inventory-baseline.ts`

Read-only stdin adapter for the canonical inventory baseline builder. It accepts a JSON array of canonical `InventoryRow` records and emits the builder's deterministic baseline JSON to stdout. It performs no Airtable or Production writes.

Before wiring this into CI or a live connector, verify the canonical builder import path and add a package script plus fixture test.
