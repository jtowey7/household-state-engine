# Source → Basket vertical slice (ISOLATED SYNTHETIC EVIDENCE)

Closes the seam between the **production-adapter boundary** (mode / provenance /
immutable-ID / quarantine guards) and the already-tested **replay → quantity →
procurement** chain, in one executable composition:

```
Airtable-shaped synthetic rows (real HOUSEHOLD EVENTS field contract)
  → createAirtableProductionPort (SYNTHETIC mode) | createMemoryProductionPort
  → loadProductionState()          boundary guards
  → replayEvents()                 State Engine
  → toQuantityRequirementsHandoff()
  → adaptSnapshotToQuantityRun()   quantity requirements
  → aggregateCandidateBasket()     existing procurement aggregation
```

No maths is re-implemented here — every stage calls the module that owns it.

## Boundary

This is **isolated synthetic evidence, not production operational evidence.**
`SYNTHETIC` scope only, explicit synthetic provenance, no Airtable credentials,
no real household state, no writes, no dispatch. `dispatched` is always `false`
and `requiresHumanApproval` is always `true`.

## Contracts asserted (`slice.test.ts`)

| # | Contract |
| - | --- |
| 1 | Airtable-shaped source reaches quantity/procurement with no static INVENTORY fallback |
| 2 | snapshotId / replayId / replayTimestamp and source Event IDs survive into requirements and basket lines |
| 3 | Identical duplicate Event ID is idempotent end-to-end (same snapshot/plan/basket identity, one mutation) |
| 4 | Reused Event ID with a changed payload blocks quantity + procurement; no dispatch |
| 5 | `Record class = Test` is excluded before ID-conflict handling and cannot contaminate state |
| 6 | Synthetic provenance is refused in `PRODUCTION_READ_ONLY` mode, and nothing downstream executes |
| 7 | Procurement aggregation is the existing implementation, preserves requirement/source provenance, still requires human approval |
| 8 | Reconciliation status is carried verbatim into the handoff and quantity plan |
| 9 | Unsupported source rows (Confirmation/Transfer/…) stay explicit and never become a stock change |
| 10 | Malformed rows (missing unit, unmappable Correction) are explicit and quarantine only their own item |
| 11 | Legacy/invented field names are refused outright, never partially accepted |
