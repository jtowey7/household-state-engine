# AGENT RUN — materialised-state identity vs evidence identity

**Scope:** synthetic fixtures only. No Airtable access, no production household
data read or written, no dispatch, no UI change.

## Finding (reproduced before fixing)

Replaying the same logical ledger with an identical duplicate delivery left the
materialised quantity, `replayId` and `snapshotId` unchanged, but produced a
different downstream `planId` (and therefore basket/approval identity). Cause:
`adaptSnapshotToQuantityRun()` hashed the *evidence* `reconciliationStatus`,
which flips `CLEAN -> EXCEPTIONS` for the audit-only
`DUPLICATE_EVENT_IGNORED` exception.

Reproduction: `src/lib/source-to-basket/duplicate-delivery-identity.test.ts`
(initially 7/8 passing; the plan-identity assertion failed).

## Invariant enforced

Evidence/reconciliation identity is now explicitly separate from
materialised-state identity.

- `StateSnapshot.canonicalReconciliationStatus` (and the same optional field on
  `QuantityRequirementsHandoff`) excludes audit-only exceptions
  (`DUPLICATE_EVENT_IGNORED`, `TEST_RECORD_EXCLUDED`).
- `reconciliationStatus` is unchanged and still reports the duplicate as
  evidence.
- Quantity plan identity hashes the canonical status, so an identical duplicate
  delivery cannot change `planId` / `basketId` / approval fingerprint while the
  materialised state is byte-identical. A reused Event ID with a *changed*
  payload still changes identity and blocks.

## Adjacent coverage added

- Identical requirement submitted twice aggregates idempotently.
- Re-running procurement on the same plan yields a byte-identical basket.
- Missing retailer catalogue evidence yields an explicit `NO_CATALOGUE_MATCH`
  unsourceable exception with no guessed SKU or price.

## Planned-meal completion idempotency

Verified already implemented and passing at
`src/lib/meal-completion/adapter.ts` (+ `adapter.test.ts`): completion feeds the
existing `canonicaliseAppend` / PROPOSE_APPEND boundary, keyed by
completion + ingredient; duplicate evaluation dedupes; skipped/cancelled propose
nothing; changed meals do not silently consume; missing quantity or mixed units
isolate the ingredient. No new work required.

## Evidence

- `bunx vitest run` — 175 files, 1133 tests, all passing.
- `bunx tsgo --noEmit` — 305 pre-existing strict-mode errors, none referencing
  the changed identity fields; the changed files added no new errors.

## Changed files

- `src/lib/state-engine/engine.ts`
- `src/lib/state-engine/types.ts`
- `src/lib/state-engine/engine.test.ts`
- `src/lib/quantity-adapter/adapter.ts`
- `src/lib/source-to-basket/duplicate-delivery-identity.test.ts`

## Next frontier

Reduce the pre-existing strict-mode typecheck debt concentrated in
`src/lib/event-writer/*` and `src/lib/consumption/reconciliation.ts`.
