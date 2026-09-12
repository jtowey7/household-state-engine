# Household State Engine

Build the Food OS executable State Engine as the next implementation frontier identified in the Food OS Airtable control plane. This is an implementation task, not a design-only exercise. Build a small production-shaped TypeScript runtime, isolated from real household production data, with a deterministic function/API that takes an ordered production HOUSEHOLD EVENTS stream and returns a materialised household-state snapshot plus provenance and explicit reconciliation exceptions. Contract: immutable Event ID is applied at most once; identical duplicate Event IDs are idempotent; reuse of an Event ID with a different canonical payload is a data-integrity conflict and must cause no second mutation; Record class = Test has zero effect; superseded events are not applied; unresolved conflicts remain explicit and block downstream quantity/procurement; replay is deterministic; output includes snapshot/replay ID, replay timestamp, contributing event IDs and reconciliation status. Add automated tests for deterministic repeatability, duplicate delivery, reused-ID payload conflict, Test-event exclusion, supersession, unresolved conflict blocking, provenance preservation, and a replay output suitable for the existing QUANTITY REQUIREMENTS handoff. Do not invent wider Food OS behaviour and do not connect to real household data yet. Run the complete test suite and report exact results. Include a concise README explaining the implementation boundary and how it maps to the existing Food OS contract.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e00d6427-ea4e-4a88-8ee6-895a46ab6157).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Event contract conformance harness

A small QA/observability harness in `src/lib/state-engine/contract-conformance.ts` reuses the real `replayEvents` engine against **fixed, local-only synthetic fixtures** to report pass/fail for every clause of the household event contract. It re-implements no replay logic and touches no production data or external services.

| Check | Clause |
| ----- | ------ |
| **C1** | Identical duplicate Event ID is idempotent |
| **C2** | Reused Event ID with a different payload → conflict, no second mutation |
| **C3** | Record class = Test has zero effect on materialised state |
| **C4** | Superseded events are excluded from materialised state |
| **C5** | Unresolved conflicts remain explicit and block the affected item |
| **C6** | Replay is deterministic for an identical stream |

All fixtures are synthetic and live in the test/runtime tree only. The harness was verified at **835 tests passing**.

