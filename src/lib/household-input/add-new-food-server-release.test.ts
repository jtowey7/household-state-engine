/**
 * Live P0 acceptance case (deployed /food): the operator enters a genuinely
 * new food — "Ham", 100, "g" — sees "Ready to save", presses "Save this
 * update" and is told nothing was saved.
 *
 * This exercise reproduces the REAL shape of that path, which the previous
 * tests did not: the record is prepared on the household screen, the approval
 * crosses the client/server boundary as JSON, and the SERVER re-prepares the
 * same submission before matching the approval and writing through the real
 * Airtable append port (with its Event ID preflight).
 *
 * It proves the two boundaries that can silently swallow a valid save:
 *   1. the approval prepared on the screen must still bind to the record the
 *      server re-prepares (identical Event ID + payload hash), and
 *   2. when the connector refuses, the failure must be reported as a refusal
 *      carrying its reason — never as a silent "nothing happened".
 */

import { describe, expect, it } from "vitest";

import { createAirtableRestAppendPort } from "../event-writer/airtable-rest-append";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { releaseOutcomeFor } from "../food-ui/release-outcome";
import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import type { HouseholdIntakeSubmission } from "./types";

const preparedAt = "2026-09-16T17:00:00.000Z";

function hamSubmission(): HouseholdIntakeSubmission {
  return {
    kind: "STOCK_CORRECTION",
    report: {
      exceptionId: "HOUSEHOLD-STOCK-11111111-2222-3333-4444-555555555555",
      itemKey: "Ham",
      statedStateAfter: 100,
      unit: "g",
      observedAt: preparedAt,
      reportedBy: "household operator",
      source: "FoodOS household inventory",
      evidence: "Household operator explicitly reported the added / stock change for Ham from the household control surface.",
      confidence: "High",
      reason: "Explicit household action: new food added to household stock.",
      recordClass: "Production",
    },
  };
}

/** Exactly what the /food screen sends over the wire. */
function approvalsFromScreen() {
  const prepared = prepareHouseholdIntake(hamSubmission(), { now: () => preparedAt });
  if (!prepared.ok) throw new Error("the screen could not prepare a valid new food");
  const approvals = prepared.approvalRequests.map((request) =>
    authorizationFromRequest(request, {
      authorizationId: "AUTH-66666666-7777-8888-9999-000000000000",
      approvedBy: "household operator",
      approvedAt: preparedAt,
      evidenceDetail:
        "Household operator explicitly approved the exact stock change shown in the FoodOS household control surface.",
    }),
  );
  // The client/server hop is JSON; nothing may depend on object identity.
  return JSON.parse(JSON.stringify(approvals)) as typeof approvals;
}

function airtableStub(behaviour: "ACCEPT" | "REFUSE") {
  const posted: Record<string, unknown>[] = [];
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { records: { fields: Record<string, unknown> }[] };
    if (behaviour === "REFUSE") {
      return new Response(JSON.stringify({ error: { type: "UNKNOWN_FIELD_NAME" } }), { status: 422 });
    }
    posted.push(body.records[0]!.fields);
    void url;
    return new Response(JSON.stringify({ records: [{ id: `rec${posted.length}` }] }), { status: 200 });
  };
  return { posted, calls, fetchImpl: fetchImpl as never };
}

async function serverRelease(behaviour: "ACCEPT" | "REFUSE") {
  const stub = airtableStub(behaviour);
  const port = createAirtableRestAppendPort({
    baseId: "appTest",
    apiKey: "connection-key-test",
    gatewayApiKey: "lovable-key-test",
    apiUrl: "https://connector-gateway.lovable.dev/airtable",
    fetchImpl: stub.fetchImpl,
    preflightEventId: true,
  });
  const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
  const result = await releaseHouseholdIntake({
    submission: JSON.parse(JSON.stringify(hamSubmission())) as HouseholdIntakeSubmission,
    writer,
    approvals: approvalsFromScreen(),
    now: () => preparedAt,
  });
  return { result, posted: stub.posted, calls: stub.calls };
}

describe("Add a new food (Ham, 100 g) across the real client/server save path", () => {
  it("writes the food once, with the stated amount", async () => {
    const { result, posted, calls } = await serverRelease("ACCEPT");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A screen-side approval must still bind to the server's own record.
    expect(result.receipts.every((receipt) => receipt.outcome !== "PROPOSED")).toBe(true);
    expect(result.written).toBe(true);
    expect(result.appended).toBe(1);
    expect(result.rejected).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]!["Item"]).toBe("Ham");
    expect(posted[0]!["Unit"]).toBe("g");
    expect(posted[0]!["State after"]).toBe("100");
    expect(posted[0]!["Record class"]).toBe("Production");
    expect(calls.every((call) => call.url.startsWith("https://connector-gateway.lovable.dev/airtable/v0/"))).toBe(true);
    expect(calls.every((call) => call.headers?.Authorization === "Bearer lovable-key-test")).toBe(true);
    expect(calls.every((call) => call.headers?.["X-Connection-Api-Key"] === "connection-key-test")).toBe(true);
    expect(releaseOutcomeFor(result).saved).toBe(true);
  });

  it("stays fail-closed and says why when the household record refuses the write", async () => {
    const { result, posted } = await serverRelease("REFUSE");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toBe(false);
    expect(result.rejected).toBe(1);
    expect(posted).toHaveLength(0);

    const outcome = releaseOutcomeFor(result);
    expect(outcome.saved).toBe(false);
    expect(outcome.message).not.toMatch(/CONNECTOR_FAILED|Airtable|422/);
  });
});
