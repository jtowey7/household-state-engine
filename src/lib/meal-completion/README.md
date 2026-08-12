# Meal completion -> canonical consumption proposal

Boundary: a completed planned meal becomes one or more **Consumption**
`AppendIntent`s on the existing canonical writer path (`canonicaliseAppend` /
`previewOfRecord`). No parallel event schema, no connector, no INVENTORY
mutation, no Airtable write. Every output is a preview with
`wouldWrite: false` and `requiresHumanAuthorization: true`.

Rules encoded:

- `COMPLETED` proposes consumption for its structured ingredient lines.
- `SKIPPED` / `CANCELLED` propose nothing.
- `CHANGED` proposes nothing: the replacement completion identity must drive
  consumption, so a superseded plan can never silently consume.
- Missing / non-finite / negative quantity, missing unit, or mixed units
  isolate that item as an exception; no quantity is ever invented.
- Duplicate ingredient lines for one item aggregate deterministically before
  any proposal is generated.
- Identity: `proposalKey = completionId::itemKey`; the Event ID comes from the
  canonical payload. Repeated scheduler evaluation with identical quantity and
  provenance is deduped. A changed quantity or changed provenance surfaces
  `PROPOSAL_PAYLOAD_CONFLICT` / `PROPOSAL_PROVENANCE_CONFLICT` instead of
  collapsing into the old proposal.

Integration: the weekly cycle passes `mealCompletions` and prior
`knownMealProposals` into the `PROPOSE_APPEND` stage only.
