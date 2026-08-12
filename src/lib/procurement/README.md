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
