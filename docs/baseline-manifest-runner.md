# Baseline manifest runner

The `baseline:manifest` command is intentionally read-only. It accepts a canonical INVENTORY snapshot on stdin and emits the deterministic baseline manifest; it must not write Airtable or Production household state.

The runner requires `tsx` to be declared in the repository dependencies before CI or local execution is considered supported. See issue #4.
