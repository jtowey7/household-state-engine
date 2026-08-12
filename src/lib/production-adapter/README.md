# Production-state adapter — read-only source boundary

`adapter.ts` + `types.ts` define the only sanctioned way the runtime reads
household state. The port has `read()` and nothing else, and
`LoadedProductionState.writable` is always `false`.

## Airtable port status (this pass)

The workspace currently has **no Airtable connection**, so no live base is
reachable from this project. Rather than stopping, `airtable-port.ts`
implements the full production-shaped boundary a real connector drops into:

- `AirtableRowSource` — read-only fetch interface (`listEventRows`,
  `listTargetRows`). `assertReadOnlySource` refuses any object exposing
  `create/update/patch/delete/upsert/...`, so a write-capable client cannot be
  installed behind the port by accident.
- `mapEventRow` / `mapTargetRow` — explicit field mapping
  (`Event ID`, `Record Class`, `Event Type`, `Item Key`, `Occurred At`,
  `Quantity`, `Unit`, `Note`, `Supersedes`). No blind spread: an unknown
  Airtable column can never change canonical payload identity. Event IDs are
  taken verbatim and never generated from the Airtable `rec…` id.
  `Record Class = Test` is preserved so the State Engine excludes it;
  `Supersedes` is preserved so supersession stays authoritative.
- Structurally bad rows are emitted as-is and quarantined by
  `loadProductionState` — per item, never repaired or guessed.
- `createFakeAirtableRowSource` is a labelled **synthetic** stand-in used by the
  contract tests. The provenance guard refuses to let it claim production mode.

Wiring real rows later is a constructor change: implement `AirtableRowSource`
against the connector and pass `mode: "PRODUCTION_READ_ONLY"`.

## Tests

- `adapter.test.ts` — 10 tests (mode/provenance guards, duplicate IDs,
  quarantine, unavailable source, determinism).
- `airtable-port.test.ts` — 13 tests (field mapping, Test class, supersession,
  write refusal, shared port contract, malformed rows, reused IDs, connector
  failure, determinism).
