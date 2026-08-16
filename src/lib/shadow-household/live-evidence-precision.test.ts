import { describe, expect, it } from "vitest";

import { attemptLiveShadowRun } from "./live";
import { declaredPlan, shadowAsOf, shadowScope, shadowTargets } from "./case";
import { AIRTABLE_ENV_KEYS, type FetchLike } from "../production-adapter/airtable-rest-source";

const liveEnv = {
  [AIRTABLE_ENV_KEYS.apiKey]: "ak",
  [AIRTABLE_ENV_KEYS.baseId]: "appTEST000000000",
  [AIRTABLE_ENV_KEYS.eventsTable]: "HOUSEHOLD EVENTS",
};

const qualifiedDelivery = {
  id: "recQUALIFIED001",
  fields: {
    "Event ID": "EVT-QUALIFIED-0001",
    "Event type": "Delivery",
    "Occurred at": "2026-08-11T09:15:00.000Z",
    Evidence: "approximately 780 g received",
    Item: "tesco-6-boneless-salmon-fillets-780g",
    "Quantity delta": 780,
    Unit: "g",
    "Record class": "Production",
  },
};

const fetchQualified: FetchLike = async () => ({
  ok: true,
  status: 200,
  async text() {
    return "";
  },
  async json() {
    return { records: [qualifiedDelivery] };
  },
});

describe("live shadow evidence precision boundary", () => {
  it("preserves qualified source evidence through the shadow-run adapter", async () => {
    const outcome = await attemptLiveShadowRun({
      scope: shadowScope,
      plan: declaredPlan,
      demandTargets: shadowTargets,
      asOf: shadowAsOf,
      env: liveEnv,
      fetchImpl: fetchQualified,
    });

    expect(outcome.status).toBe("SHADOW_RUN_COMPLETE");
    if (outcome.status !== "SHADOW_RUN_COMPLETE") return;

    const event = outcome.run.source?.openingEvents.find(
      (candidate) => candidate.eventId === "EVT-QUALIFIED-0001",
    );
    expect(event?.payload.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
    expect(event?.payload.quantity).toBe(780);
    expect(outcome.run.mutatedHouseholdState).toBe(false);
    expect(outcome.run.dispatched).toBe(false);
  });
});
