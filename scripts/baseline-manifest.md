# Read-only baseline manifest

Run the canonical inventory baseline builder without any Airtable or Production writes:

```bash
bun run baseline:manifest < snapshot.json
```

Input must be a JSON object containing `baselineTimestamp` and `rows`. The command emits the deterministic baseline and audit result as JSON.
