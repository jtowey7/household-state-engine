# EXPECTED vs CONFIRMED household state (`src/lib/expected-state/`)

Isolated seam that keeps *planned* consumption and *observed* household state
apart, and reconciles them only through explicit evidence.

## Boundary

- Pure functions, no I/O, no connector, no Airtable, synthetic fixtures only.
- Core State Engine replay semantics, Event ID identity, `Record class = Test`
  isolation, provenance and the approval / non-dispatch boundary are unchanged.
- Nothing here writes production state; the output is a read-only handoff.

## Contract

`reconcileExpectedWithConfirmed({ openingEvents, expectations, evidence }, { asOf, now, tolerance })`

1. **Separation.** Expectations replay into `expectedSnapshot` as
   `EXPECTED:<expectationId>` events; evidence replays into a *separate*
   `confirmedSnapshot` as `CONFIRMED:<evidenceId>` events. Only the confirmed
   view is handed downstream — planning never masquerades as observed truth.
2. **Evidence, not mutation.** A household interaction produces
   `ConsumptionEvidence` (actor, source, confidence, observed quantity/unit).
   Insufficient evidence (missing quantity/unit, `UNKNOWN` confidence) confirms
   nothing and isolates the item.
3. **Explicit reconciliation.** Each expectation yields one entry:
   `MATCHED`, `DIVERGED`, `AWAITING_EVIDENCE`, `NOT_DUE`,
   `EVIDENCE_INSUFFICIENT`, `UNIT_CONFLICT`, `EVIDENCE_PAYLOAD_CONFLICT`, or
   `UNEXPECTED_CONFIRMED` for evidence with no plan behind it.
4. **Dual burn-down.** `forecast[]` reports `expectedRemaining` and
   `confirmedRemaining` side by side with their `divergence`; disagreement is
   never averaged or auto-resolved.
5. **Downstream safety.** Diverged / insufficient / conflicted items enter
   `blockedItemKeys` and are withheld from `handoff`. Under the quantity
   adapter's default `REFUSE_RUN` policy the whole run refuses; under
   `ISOLATE_ITEMS` only the affected item is withheld and the rest of the
   household keeps planning.
6. **Idempotency.** Evidence ids are immutable: an identical duplicate delivery
   is a no-op (same snapshot ids, same entries, same handoff); a reused id with
   a different canonical payload conflicts, applies no second mutation and
   blocks the item. `Record class = Test` evidence has zero effect.

## Tests

`ledger.test.ts` covers the clean path, provenance, dual forecast,
determinism, divergence, insufficient evidence, unit conflict, unplanned
confirmed consumption, duplicate/idempotent delivery, reused-id conflict, Test
isolation, and both downstream blocking policies.
