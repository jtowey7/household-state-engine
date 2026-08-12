# Production-state adapter — read-only source boundary

`adapter.ts` + `types.ts` define the only sanctioned way the runtime reads
household state. The port has `read()` and nothing else, and
`LoadedProductionState.writable` is always `false`.

## Airtable port status (this pass)

The workspace currently has **no Airtable connection**, so no live base is
reachable from this project and no live read has been performed.
`airtable-port.ts` implements the production-shaped boundary a read-only
connector drops into, mapped against the **real** HOUSEHOLD EVENTS contract.

### Real field contract (verbatim)

`Event ID`, `Event type`, `Occurred at`, `Recorded at`, `Source`, `Actor`,
`Entity type`, `Entity reference`, `Item`, `Quantity delta`, `Unit`, `Evidence`,
`State before`, `State after`, `Confidence`, `Supersedes event ID`,
`Exception / reconciliation action`, `Replay status`, `Record class`.

`Event type` choices: Delivery, Receipt, Consumption, Correction, Confirmation,
Disposal, Transfer, Substitution, Unavailable, Other.
`Record class` choices: Production, Test.

### Mapping rules

| Airtable `Event type` | Canonical event |
| --- | --- |
| Delivery, Receipt | `ITEM_STOCK_DELTA`, `+|Quantity delta|` |
| Consumption, Disposal | `ITEM_STOCK_DELTA`, `-|Quantity delta|` |
| Correction | `ITEM_STOCK_SET` from numeric `State after` + `Unit`; otherwise `UNMAPPABLE_CORRECTION` |
| Confirmation, Transfer, Substitution, Unavailable, Other | never a stock change — kept as an explicit `UNSUPPORTED_EVENT_TYPE` source record |

- `AirtableRowSource` exposes `listEventRows` only. `assertReadOnlySource`
  refuses any object exposing `create/update/patch/delete/upsert/...`.
- Event IDs come from `Event ID` verbatim — the Airtable `rec…` id is never used.
- Quantities and units are never invented: a missing one is an explicit
  rejection (`MISSING_QUANTITY_DELTA` / `MISSING_UNIT`).
- `Record class` is preserved verbatim so the State Engine excludes Test rows;
  `Supersedes event ID` is preserved so supersession stays authoritative.
- Provenance (`Source`, `Actor`, `Evidence`, `Confidence`, `Replay status`,
  `Exception / reconciliation action`, entity refs, `Recorded at`) is returned
  alongside the event, never folded into the canonical payload, so it cannot
  alter event identity.
- Structural failures quarantine only their own item; `UNSUPPORTED_EVENT_TYPE`
  rows are informational and quarantine nothing.
- Legacy invented field names (`Item Key`, `Quantity`, `Note`, `Supersedes`,
  `Event Type`) are rejected with `LEGACY_FIELD_SCHEMA`.
- `createFakeAirtableRowSource` is a labelled **synthetic** stand-in used by the
  contract tests. The provenance guard refuses to let it claim production mode.

### Source of truth separation

HOUSEHOLD EVENTS supplies **state only**. There is no PAR LEVELS table and the
port never returns demand targets: `ProductionReadResult.targets` is optional
and weekly meal/quantity planning supplies targets downstream
(`WeeklyCycleOptions.demandTargets`).

Wiring real rows later is a constructor change: implement `AirtableRowSource`
against the connector and pass `mode: "PRODUCTION_READ_ONLY"`.

## Tests

- `adapter.test.ts` — 10 tests (mode/provenance guards, duplicate IDs,
  quarantine, unavailable source, determinism).
- `airtable-port.test.ts` — 27 tests (real-schema mapping, Test class exclusion,
  supersession, correction semantics, unsupported types, missing quantity/unit,
  malformed quarantine, legacy-field regression, no-par-levels regression,
  provenance preservation, write refusal, port contract, determinism).

