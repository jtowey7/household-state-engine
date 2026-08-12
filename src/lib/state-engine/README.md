# Food OS — Executable State Engine (isolated runtime)

Deterministic replay of an ordered HOUSEHOLD EVENTS stream into a materialised
household-state snapshot with provenance and explicit reconciliation exceptions.

## Implementation boundary

- Pure TypeScript, no I/O, no network, no Airtable, no real household data.
- Only the event → state materialisation contract is modelled. No wider Food OS
  behaviour (planning, recipes, procurement logic) is invented here.
- The QUANTITY REQUIREMENTS handoff is emitted as a shaped output object only;
  nothing downstream is executed.

## Contract mapping

| Food OS contract rule | Implementation |
| --- | --- |
| Event ID applied at most once | first-occurrence registry keyed by `eventId` |
| Identical duplicate is idempotent | duplicate identity hash → `DUPLICATE_EVENT_IGNORED`, no mutation |
| Reused ID + different payload = integrity conflict | canonical payload hash mismatch → `REUSED_EVENT_ID_PAYLOAD_CONFLICT`, blocking, no second mutation |
| Record class = Test has zero effect | Test events skipped, cannot supersede, `TEST_RECORD_EXCLUDED` |
| Superseded events not applied | pre-pass builds supersession set from production events; order-independent |
| Unresolved conflicts block downstream | affected item keys marked `blocked`, excluded from handoff, `readyForQuantityRun = false` |
| Replay is deterministic | canonical serialisation + pure hashing; clock injected via `now` |
| Output identity & provenance | `replayId`, `snapshotId`, `replayTimestamp`, `contributingEventIds`, per-item `contributingEventIds`, `reconciliationStatus` |

## API

```ts
import { replayEvents, toQuantityRequirementsHandoff } from "@/lib/state-engine";

const snapshot = replayEvents(events);              // deterministic materialisation
const handoff = toQuantityRequirementsHandoff(snapshot);
```

`reconciliationStatus` is `CLEAN`, `EXCEPTIONS` (non-blocking only) or `BLOCKED`.

## Tests

```
bunx vitest run src/lib/state-engine
```
