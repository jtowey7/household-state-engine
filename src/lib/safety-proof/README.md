# Safety-boundary proof — adapter → replay → QUANTITY REQUIREMENTS

Deterministic, read-only proof that the existing executable State Engine
enforces its downstream safety boundary. It composes existing modules only and
re-implements no replay, quantity or procurement maths:

```
synthetic Airtable-shaped HOUSEHOLD EVENTS rows
  → mapHouseholdEventRowsWithEvidencePrecision()
  → replayEvents()
  → toQuantityRequirementsHandoff()
  → adaptSnapshotToQuantityRun({ blockedItemPolicy: "ISOLATE_ITEMS" })
```

## Proven checks (`proof.ts`)

| Check | Contract |
| --- | --- |
| `PROD_EVENTS_MAPPED` | Production rows map to canonical events, no structural failures |
| `TEST_ROWS_INERT` | `Record class = Test` is ignored: absent from state, handoff, requirements |
| `QUALIFIED_ITEM_BLOCKED` | Qualified evidence blocks only its own item (`ITEM_ISOLATED`) |
| `UNRELATED_ITEMS_ELIGIBLE` | Exact items still emit requirements, including zero on-hand targets |
| `IDENTITY_PRESERVED` | `replayId` / `snapshotId` / source Event IDs carried end to end |

## Boundary

Synthetic fixtures (`fixtures.ts`) using the real HOUSEHOLD EVENTS field names.
No Airtable read, no production write, no procurement dispatch: the run reports
`readOnly: true` and `dispatched: false`.
