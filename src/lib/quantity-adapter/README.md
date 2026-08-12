# Replay → Quantity Requirements adapter (isolated seam)

Pure, side-effect-free adapter from **State Engine output** into the
deterministic quantity/procurement contract.

## Boundary

- Input is **only** `StateSnapshot` or `QuantityRequirementsHandoff` from
  `src/lib/state-engine`. No other data source is read.
- No I/O, no Airtable, no real household data. Shadow runs use synthetic
  fixtures and never dispatch anything downstream (`dispatched: false`).
- Core replay semantics are untouched.

## Contract

`adaptSnapshotToQuantityRun(input, { targets })` returns a `QuantityRunPlan`:

- preserves `replayId`, `snapshotId`, `replayTimestamp`, `reconciliationStatus`
  and per-item `sourceEventIds` verbatim;
- refuses execution (`executed: false`, empty requirements) when the replay is
  `BLOCKED`, when the handoff is not ready, or when any blocked item keys are
  present (`RECONCILIATION_UNCERTAIN`);
- consolidates duplicate lines per item, summing quantity and unioning
  provenance in first-seen order;
- drops lines with unit mismatch, non-positive on-hand/target/required
  quantities, missing demand targets, or incompatible pack configuration —
  each recorded as a non-fatal rejection;
- emits `packCount = ceil(required / packSize)` and `packRoundedQuantity`
  so the existing pack-rounding logic can consume the plan unchanged;
- returns a deterministic `planId` hash of identity + requirements + rejections.

`eligibleForProcurement` is true only when at least one requirement survived.
It signals eligibility; it does not mean anything downstream was invoked.

## Tests

`bunx vitest run src/lib/quantity-adapter` — clean replay → requirements,
provenance preservation, blocked replay → no requirements, uncertain refusal,
deterministic repeat, zero/negative rejection, unit mismatch rejection,
duplicate consolidation, pack-rounding compatibility, no dispatch.
