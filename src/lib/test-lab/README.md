# TEST LAB — replay ↔ quantity/procurement integration

Executable, isolated integration harness. It wires the **existing** pieces together and
asserts their contract; it does not re-implement aggregation, pack rounding, or ACTION POLICY.

```
HouseholdEvent[] (synthetic)
  → replayEvents()
  → toQuantityRequirementsHandoff()
  → adaptSnapshotToQuantityRun()
  → QuantityRunPlan (snapshotId, replayId, status, source event IDs)
```

`runReplayToQuantityIntegration()` always reports `dispatched: false` — shadow runs only.

## Cases (`cases.ts`)

| Case | Contract |
| --- | --- |
| LAB-A | normal replay → quantity handoff, identity carried through |
| LAB-B | provenance: source event IDs preserved in application order |
| LAB-C | identical duplicate Event ID is idempotent, run still executes |
| LAB-D | reused Event ID w/ different payload → BLOCKED, procurement refused |
| LAB-E | Record class = Test never affects materialised state or provenance |
| LAB-F | superseded events excluded from the quantity run |
| LAB-G | repeated identical shadow run is byte-identical |
| LAB-H | absent snapshot → fatal `MISSING_REPLAY_SNAPSHOT`, no static-inventory fallback |

## Boundary

Synthetic fixtures only. No Airtable, no real household production state, no procurement
dispatch. Wider Food OS integration is **not** live.
