/**
 * Food OS — plain-English component catalogue and roadmap/shift log.
 *
 * Static, hand-maintained descriptions. Nothing here reads or writes data;
 * it exists so the development dashboard can teach what each part does.
 */

import type { ComponentNote, RoadmapBlock, ShiftEntry } from "./types";

export const COMPONENTS: Record<string, ComponentNote> = {
  stateEngine: {
    name: "Household State Engine",
    does: "Replays the ordered list of household events into one agreed picture of what is in the house right now, and flags anything contradictory instead of guessing.",
    path: "src/lib/state-engine",
  },
  productionAdapter: {
    name: "Production source adapter",
    does: "Reads the real household event/inventory tables without ever writing to them, and quarantines rows it cannot trust.",
    path: "src/lib/production-adapter",
  },
  consumption: {
    name: "Consumption projector",
    does: "Turns completed planned meals and daily allocations into the food that was actually used, so stock burns down on its own.",
    path: "src/lib/consumption",
  },
  quantity: {
    name: "Quantity adapter",
    does: "Compares what you have against what a week needs and produces the shortfall for each item.",
    path: "src/lib/quantity-adapter",
  },
  procurement: {
    name: "Procurement aggregator",
    does: "Rolls shortfalls into a single candidate shopping basket, deduplicated and rounded to real pack sizes. It never places an order.",
    path: "src/lib/procurement",
  },
  feedback: {
    name: "Feedback gate",
    does: "Sorts what you tell Food OS into one-off notes, lasting preferences and hard safety rules, and stops planning in the areas a hard rule affects.",
    path: "src/lib/feedback",
  },
  writer: {
    name: "Append-only write boundary",
    does: "Prepares valid new household event rows for a human to approve. It holds no credentials and writes nothing today.",
    path: "src/lib/event-writer",
  },
  scheduler: {
    name: "Scheduler cycle",
    does: "The stateless wake-up: it re-reads the control plane, claims one job, runs it, and leaves a durable audit record.",
    path: "src/lib/scheduler",
  },
  weekly: {
    name: "Weekly shadow cycle",
    does: "Chains every stage end to end — read, consume, replay, gate, quantify, basket, approval — without touching real data.",
    path: "src/lib/weekly-cycle",
  },
  testLab: {
    name: "Integration test lab",
    does: "Runs the replay-to-quantity path against synthetic cases in the browser, so the pipeline proves itself live.",
    path: "src/lib/test-lab",
  },
  expectedState: {
    name: "Expected vs confirmed ledger",
    does: "Keeps what Food OS expects to have happened separate from what you have actually confirmed.",
    path: "src/lib/expected-state",
  },
};

export const ROADMAP: RoadmapBlock[] = [
  {
    id: "RB-1",
    title: "Trustworthy household state",
    purpose: "One deterministic, replayable picture of what is in the house, with conflicts made explicit rather than hidden.",
    state: "DONE",
    progress: 100,
    evidence: "Deterministic replay, duplicate-safe event IDs and conflict blocking are covered by the engine test suite.",
    components: [COMPONENTS.stateEngine, COMPONENTS.expectedState],
  },
  {
    id: "RB-2",
    title: "Automatic consumption",
    purpose: "Planned meals burn stock down on their own; anything unplanned is an exception, not a silent edit.",
    state: "DONE",
    progress: 100,
    evidence: "Consumption projector and meal-completion proposals run inside the weekly cycle.",
    components: [COMPONENTS.consumption],
  },
  {
    id: "RB-3",
    title: "Quantities and candidate basket",
    purpose: "Turn the shortfall into a deduplicated, pack-rounded shopping basket a human can approve.",
    state: "DONE",
    progress: 100,
    evidence: "Quantity adapter drives from planned demand targets; procurement aggregates coverage and never dispatches.",
    components: [COMPONENTS.quantity, COMPONENTS.procurement],
  },
  {
    id: "RB-4",
    title: "Feedback that actually propagates",
    purpose: "Preferences and safety rules change future planning instead of living in a note somewhere.",
    state: "IN_PROGRESS",
    progress: 60,
    evidence: "Classification and pre-planning refusal are live; applying a durable preference to plans still needs a human-approved path.",
    components: [COMPONENTS.feedback],
  },
  {
    id: "RB-5",
    title: "Scheduled autonomous operation",
    purpose: "A scheduled wake-up does the week's work by itself, safely, with an audit trail.",
    state: "IN_PROGRESS",
    progress: 70,
    evidence: "Stateless cycle, directive claims, duplicate-wake protection and AGENT RUN evidence exist against an in-memory control plane.",
    components: [COMPONENTS.scheduler, COMPONENTS.weekly],
  },
  {
    id: "RB-6",
    title: "Writing back to the real household",
    purpose: "Approved events reach the real tables — the last step before Food OS is more than a shadow.",
    state: "NOT_STARTED",
    progress: 20,
    evidence: "The write boundary validates and previews rows, but no credentials are provisioned and no write path is enabled.",
    components: [COMPONENTS.writer, COMPONENTS.productionAdapter],
  },
];

/** Recent development shifts, newest first. Hand-maintained. */
export const SHIFTS: ShiftEntry[] = [
  {
    id: "SH-09",
    at: "2026-08-12",
    title: "Feedback gate visible in the console",
    change: "The weekly cycle now shows why it refused or warned, with durable preferences listed as proposals only.",
    kind: "UI",
  },
  {
    id: "SH-08",
    at: "2026-08-11",
    title: "Feedback gate wired before planning",
    change: "A hard safety rule now stops quantities and basket work before it starts, instead of after.",
    kind: "SAFETY",
  },
  {
    id: "SH-07",
    at: "2026-08-10",
    title: "Scheduler evidence persisted",
    change: "Every wake-up writes a claim and an AGENT RUN audit row through the control-plane adapter, with malformed rows refused.",
    kind: "RELIABILITY",
  },
  {
    id: "SH-06",
    at: "2026-08-09",
    title: "Duplicate wake-ups made inert",
    change: "A repeated scheduler delivery replays its recorded evidence rather than doing the work twice.",
    kind: "RELIABILITY",
  },
  {
    id: "SH-05",
    at: "2026-08-08",
    title: "Missing-ingredient hole closed",
    change: "Items with nothing on hand now produce a requirement instead of being skipped entirely.",
    kind: "CAPABILITY",
  },
  {
    id: "SH-04",
    at: "2026-08-07",
    title: "Quick stock sweep and Tell Food OS",
    change: "Phone-first surfaces for confirming stock and reporting what really happened.",
    kind: "UI",
  },
];
