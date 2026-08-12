# Procurement — aggregated candidate basket (shadow only)

Boundary: accepts **only** a `QuantityRunPlan` from the quantity adapter and a
synthetic retailer catalogue, and emits one deterministic `CandidateBasket`.

Guarantees (all covered by `adapter.test.ts`, 10 tests):

- pure function, no I/O, no household-state writes;
- `dispatched: false` and `requiresHumanApproval: true` are structural — there
  is no submit/order path in this module;
- an ineligible or missing plan produces `PLAN_NOT_ELIGIBLE` and no lines
  (procurement never invents demand);
- unsourceable items raise `NO_CATALOGUE_MATCH` and are withheld line-by-line;
  unrelated lines keep planning;
- pack unit incomparable with the requirement unit → `PACK_UNIT_MISMATCH`,
  never a silent conversion;
- catalogue choice is deterministic (cheapest per unit, ties by SKU), whole
  packs are rounded up, and `basketId` is a stable hash of the plan identity
  plus the emitted lines;
- provenance (`sourceEventIds`), `snapshotId` and `replayId` are carried
  verbatim from the replay.

No retailer API is connected. `fixtures.ts` is a synthetic catalogue.

## Procurement integrity (duplicate demand + coverage)

- **Deduped aggregation.** Requirements are grouped by item. The *same* logical
  requirement delivered twice (same `requirementId`, or the same derived
  identity when the plan supplied none) demands once; genuinely distinct
  requirements sum into a single line. There is never a second basket line for
  one item.
- **Idempotent.** Re-aggregating the same input yields the same `basketId`,
  lines, coverage and total.
- **Provenance.** Each line carries `requirementIds` (+ `requirementCount`) and
  the unioned `sourceEventIds`, so every line traces back to quantity
  requirements and the replayed events behind them.
- **Coverage is explicit.** `coverage.demandItemKeys` /
  `sourcedItemKeys` / `unsourcedItemKeys` and `complete`. An item with no
  catalogue match, an incompatible pack unit, or conflicting demand units is
  reported as **unsourced** — never as covered.
- **No silent substitution.** Product, retailer, unit and pack size are never
  swapped or converted to make a line fit.
- **Approval boundary.** `readyForReview` means a human has something to look
  at; `readyForApproval` is true only for complete coverage. The weekly cycle
  states incomplete coverage in the approval gate and still dispatches nothing.
