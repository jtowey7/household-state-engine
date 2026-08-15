# Baseline manifest execution

The `baseline:manifest` command is intentionally read-only. It accepts a canonical INVENTORY snapshot on stdin and invokes the existing canonical baseline builder. It must never write to Airtable or Production `HOUSEHOLD EVENTS`.

Repository package management uses Bun (`bun.lock`). The command requires the `tsx` runtime to be declared explicitly before CI execution is considered valid.
