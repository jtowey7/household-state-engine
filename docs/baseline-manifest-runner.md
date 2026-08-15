# Baseline manifest runner

The `baseline:manifest` command is intentionally read-only. It accepts a canonical INVENTORY snapshot on stdin and emits the deterministic baseline manifest; it must not write Airtable or Production household state.

The repository uses Bun, so the supported invocation is `bun run baseline:manifest < snapshot.json`. No separate `tsx` runtime dependency is required.
