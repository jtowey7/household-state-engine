# Scheduler-driven stateless cycle (`src/lib/scheduler`)

The current Food OS execution layer is a **stateless scheduled wake-up**. It keeps
no memory between invocations: every cycle re-reads the control plane, re-selects
work, re-derives its result and writes the handoff back out as evidence.

## Loop

```text
BOOT
 -> read ControlPlaneSnapshot (SYNTHETIC, Airtable-shaped)
 -> selectWork()            highest-priority unblocked directive
 -> runWeeklyShadowCycle()  existing proven seams, unchanged
 -> SchedulerCycleEvidence  directive, work, checks, proposals, blocked actions
 -> nextHandoff             replayable state for the next wake-up
```

No maths is re-implemented here. Execution delegates to the weekly shadow cycle,
which chains the read-only production adapter, consumption projector, State
Engine replay, QUANTITY REQUIREMENTS handoff, quantity/procurement bridge and
approval gate.

## Boundaries enforced

- Work is **selected from control-plane state**, never hard-coded.
- `Record class = Test` directives are excluded from selection entirely.
- Blocked / dependency-gated directives are skipped with an explicit reason.
- ACTION POLICY: a directive marked `EXECUTE` is recorded as a **blocked action**;
  the scheduler only ever PREPAREs.
- Append proposals stay proposals — immutable Event IDs, human authorisation
  required, nothing written to any connector.
- Reused Event IDs with conflicting payloads quarantine the item upstream; the
  scheduler surfaces it as a blocked action and continues unrelated planning.
- `mutatedHouseholdState`, `appendedEvents` and `dispatched` are `false` by type.

## What a 20-minute wake-up can already do

Read a control-plane snapshot, pick work, load a read-only event source, project
planned consumption, replay deterministically, produce QUANTITY REQUIREMENTS,
aggregate a candidate basket, emit canonical append proposals, and persist a
replayable handoff — all deterministically and with no mutation.

## What it still cannot do

Write to Airtable (no connector credential exists), dispatch procurement, grant
approval, or run against real household production state. Directive kinds without
a proven seam are refused rather than approximated.

## Durable handoff + duplicate wake-up (handoff.ts)

The scheduler holds no memory, so continuity is a sealed record persisted in the
control plane and treated as untrusted on read-back:

- `sealHandoff(evidence)` → `HandoffRecord` with a content digest.
- `verifyHandoff(snapshot, record)` refuses `TAMPERED_HANDOFF` / `WRONG_MODE`,
  and warns (without blocking unrelated work) on `SNAPSHOT_ROTATED`,
  `UNKNOWN_DIRECTIVE`, `TEST_CLASS_DIRECTIVE` — Test-class rows can never mark
  production directives complete.
- `runSchedulerCycle({ handoff, wakeLedger })`: a refused handoff ends the
  wake-up as `REFUSED` with no work; a duplicate delivery for an already
  recorded `cycleId` replays the stored evidence verbatim and performs no new
  work (`duplicateWakeOf` set). No mutation, append or dispatch on any path.

## Claim + AGENT RUN (this pass)

- `claim.ts` — `claimDirective()` leases the selected directive to one cycle
  (`CLAIMED_BY_ANOTHER_CYCLE` refusal, re-entrant for the same cycleId, expired
  leases reclaimable via `pruneClaims`). Overlapping wake-ups can no longer both
  execute the same directive; the loser blocks with zero work.
- `agent-run.ts` — `toAgentRunRecord()` derives an Airtable-shaped AGENT RUN
  audit row from cycle evidence (Run ID, claim, snapshot/replay/plan/basket IDs,
  proposal IDs, blocked actions, and the false/false/false boundary flags).
  `createMemoryAgentRunSink()` is append-only and dedupes on Run ID, so a
  duplicate scheduler delivery records nothing new. No connector is wired: the
  sink is in-memory and every row is `Record class = Test`, Mode `SYNTHETIC`.
