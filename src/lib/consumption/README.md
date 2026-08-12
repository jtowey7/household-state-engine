# Consumption → inventory burn-down (isolated vertical slice)

Turns a **synthetic** meal plan into deterministic HOUSEHOLD EVENTS that the existing
State Engine replays. Core replay semantics are unchanged; this module only projects.

## Operating model

| Rule | Implementation |
| --- | --- |
| Completed/due meals are assumed consumed at planned household quantity | `isMealDue` + one `ITEM_STOCK_DELTA` per component; no portion reporting |
| Planned daily allocations burn at plan rate | `ALLOC:<id>:<date>` events, `perPersonPerDay × people`, only up to `asOf` |
| Durable cupboard stock is not burned | events are only emitted from plans/allocations/exceptions |
| No automatic leftovers | leftovers only when `plannedLeftovers` is set |
| Unplanned consumption is an exception | `EXC:<exceptionId>` event; never a manual inventory edit |
| Non-blocking exceptions | `UNCERTAIN_QUANTITY` isolates one item from the handoff, provenance kept |
| Immutable, idempotent | event ids derive from plan identity, so re-delivered completions are ignored by the engine |
| Date change alone never burns | `SKIPPED` / `CHANGED` / not-yet-due meals emit no events |

State transition (minimal safe set): `PLANNED → DUE → COMPLETED` burns;
`PLANNED/DUE → SKIPPED | CHANGED` never burns.

## Boundary

Fixtures are synthetic. Nothing here reads or writes Airtable or real household state.
Wider Food OS integration is **not** live.
