# Shadow household run

Runs a declared household state through the full proven chain and produces an
**isolated** result: read-only port → consumption projection → replay →
quantity requirements → candidate basket → human approval gate.

## Boundary

- **No Airtable connector exists for this project.** Nothing here is a live
  read. `case.ts` holds an operator-declared restatement of facts given in chat,
  shaped in the exact real HOUSEHOLD EVENTS field contract, so a read-only
  connector can replace the row source one-for-one later.
- The scope is `SYNTHETIC` with fixture-marked provenance, so the
  production-state guard refuses to let it masquerade as production state.
- Nothing is written: the port has no write member, `mutatedHouseholdState` and
  `dispatched` are structurally `false`, and approval stays with the human.

## Tuesday salmon

The eaten pack is represented three ways, all landing on **0 g** shadow state
with provenance intact and no inventory edit:

- **A** completed planned meal → automatic expected consumption event
- **B** `UNPLANNED_CONSUMPTION` exception event
- **C** Airtable `Correction` row with numeric `State after` = 0

## Rules exercised

- Completed planned meals generate expected consumption automatically.
- Daily allocations burn down (1 ice cream × 2 people × 2 days = 4).
- Leftovers are never invented; portion-level tracking is not required.
- Unplanned consumption is an exception event, never a stock edit.
- Uncertain items (bananas) are isolated; unrelated planning continues.
- `Test` record class and `Confirmation` rows never move stock.
