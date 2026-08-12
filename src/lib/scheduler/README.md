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
