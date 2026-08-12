/**
 * Tests for the live shadow-run entry point.
 *
 * No network, no real base, no real credentials: the connector's fetch is
 * injected and returns rows shaped like the real HOUSEHOLD EVENTS schema.
 */

import { describe, expect, it } from "vitest";
import { attemptLiveShadowRun } from "./live";
import { declaredPlan, shadowAsOf, shadowScope, shadowTargets } from "./case";
import { AIRTABLE_ENV_KEYS, type FetchLike } from "../production-adapter/airtable-rest-source";
import { createFakeAirtableRowSource } from "../production-adapter/airtable-port";

const liveEnv = {
  [AIRTABLE_ENV_KEYS.lovableApiKey]: "lk",
  [AIRTABLE_ENV_KEYS.connectionKey]: "ck",
  [AIRTABLE_ENV_KEYS.baseId]: "appTEST000000000",
  [AIRTABLE_ENV_KEYS.eventsTable]: "HOUSEHOLD EVENTS",
};

const deliveryRecord = {
  id: "recLIVE001",
  fields: {
    "Event ID": "EVT-LIVE-0001",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T09:15:00.000Z",
    Source: "Tesco order confirmation",
    Actor: "James",
    Item: "tesco-6-boneless-salmon-fillets-780g",
    "Quantity delta": 780,
    Unit: "g",
    "Record class": "Production",
  },
};

const okFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  async text() {
    return "";
  },
  async json() {
    return { records: [deliveryRecord] };
  },
});

const base = {
  scope: shadowScope,
  plan: declaredPlan,
  demandTargets: shadowTargets,
  asOf: shadowAsOf,
};

describe("live shadow run", () => {
  it("reports NOT_CONNECTED with the missing configuration instead of faking a read", async () => {
    const outcome = await attemptLiveShadowRun({ ...base, env: {} });
    expect(outcome.status).toBe("NOT_CONNECTED");
    expect(outcome.run).toBeNull();
    expect(outcome.missing).toContain(AIRTABLE_ENV_KEYS.baseId);
    expect(outcome.detail).toMatch(/No live household data/i);
  });

  it("never falls back to declared fixtures when the connector is absent", async () => {
    const outcome = await attemptLiveShadowRun({ ...base, env: {} });
    expect(outcome.run).toBeNull();
  });

  it("completes a read-only cycle from connector rows without writing or dispatching", async () => {
    const outcome = await attemptLiveShadowRun({ ...base, env: liveEnv, fetchImpl: okFetch });
    expect(outcome.status).toBe("SHADOW_RUN_COMPLETE");
    if (outcome.status !== "SHADOW_RUN_COMPLETE") return;
    expect(outcome.run.mutatedHouseholdState).toBe(false);
    expect(outcome.run.dispatched).toBe(false);
    expect(outcome.run.source?.writable).toBe(false);
    expect(outcome.run.source?.openingEvents.map((e) => e.eventId)).toContain("EVT-LIVE-0001");
  });

  it("is deterministic across identical live reads", async () => {
    const a = await attemptLiveShadowRun({ ...base, env: liveEnv, fetchImpl: okFetch });
    const b = await attemptLiveShadowRun({ ...base, env: liveEnv, fetchImpl: okFetch });
    expect(a.status).toBe("SHADOW_RUN_COMPLETE");
    if (a.status !== "SHADOW_RUN_COMPLETE" || b.status !== "SHADOW_RUN_COMPLETE") return;
    expect(a.run.cycleId).toBe(b.run.cycleId);
  });

  it("surfaces a connector failure as READ_FAILED rather than an empty household", async () => {
    const failing: FetchLike = async () => ({
      ok: false,
      status: 503,
      async text() {
        return "upstream unavailable";
      },
      async json() {
        return {};
      },
    });
    const outcome = await attemptLiveShadowRun({ ...base, env: liveEnv, fetchImpl: failing });
    expect(outcome.status).toBe("READ_FAILED");
    expect(outcome.run).toBeNull();
  });

  it("REGRESSION: a synthetic source cannot complete a PRODUCTION_READ_ONLY live run", async () => {
    const outcome = await attemptLiveShadowRun({
      ...base,
      env: liveEnv,
      sourceOverride: createFakeAirtableRowSource({ eventRows: [deliveryRecord] }),
    });
    expect(outcome.status).toBe("READ_FAILED");
    expect(outcome.run).toBeNull();
  });
});
