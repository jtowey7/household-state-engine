# USER-REPORTED INVENTORY EXCEPTION -> CANONICAL CORRECTION PROPOSAL

Maps an explicit human stock report ("the salmon is actually 0 g") onto the
**existing** canonical append path (`canonicaliseAppend` / `prepareAppend`).
No second event schema, no connector, no INVENTORY mutation.

## Boundary

- Output is always a preview: `wouldWrite: false`, `requiresHumanAuthorization: true`.
- Emits only `Event type = Correction` rows in the real 19-field HOUSEHOLD
  EVENTS contract, with item, unit, stated `State after`, `Occurred at`,
  `Source`, `Actor`, `Evidence`, `Confidence`, and the reconciliation reason in
  `Exception / reconciliation action`.
- Explicit evidence is mandatory. A missing quantity is `MISSING_QUANTITY`; a
  non-numeric report is `AMBIGUOUS_QUANTITY`. Nothing is parsed or inferred.
- Supersession is carried through only when the user supplies it; it is never
  inferred, and it changes the canonical Event ID.
- `Record class = Test` reports get their own `TEST-` identity space and are
  never queued into the production proposal stream of the weekly/shadow cycle.

## Identity and conflicts

`proposalKey = exception::${exceptionId}::${itemKey}`. Feeding a prior run's
`fingerprints` back in makes re-evaluation idempotent (`deduped`). The same
exception with a changed quantity yields `EXCEPTION_PAYLOAD_CONFLICT`, and with
materially changed evidence/provenance `EXCEPTION_PROVENANCE_CONFLICT` — the
earlier proposal is never silently overwritten.

## Cycle integration

`runWeeklyShadowCycle({ stockExceptions, knownStockExceptions })` surfaces the
run as `exceptionProposals` and adds Production proposals to `appendProposals`
in the `PROPOSE_APPEND` stage only. The cycle remains non-writing and
non-dispatching.
