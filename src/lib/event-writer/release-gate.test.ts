/**
 * Release-gate tests. These prove the seam refuses, structurally, rather than
 * degrading to a weaker path.
 */

import { describe, expect, it, vi } from "vitest";
import {
  authorizeAppend,
  canonicaliseAppend,
  createAirtableAppendPort,
  createFakeAppendPort,
  createHouseholdEventWriter,
  prepareAppend,
  productionWriteAvailable,
} from "./index";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-08-12T08:00:00.000Z";

const productionIntent: AppendIntent = {
  eventType: "Consumption",
  item: "Kerrygold Butter 250G",
  occurredAt: "2026-08-11T18:30:00.000Z",
  quantityDelta: -50,
  unit: "g",
  source: "Planned meal completion (synthetic)",
  actor: "Food OS state engine",
  evidence: "planned meal completed",
  recordClass: "Production",
};

function canonical(intent: AppendIntent) {
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture must canonicalise: ${result.rejection.code}`);
  return result.record;
}

describe("release gate", () => {
  it("refuses without an authorization decision", async () => {
    const record = canonical(productionIntent);
    expect(authorizeAppend({ record })).toMatchObject({
      granted: false,
      refusal: { code: "AUTHORIZATION_REQUIRED" },
    });

    const port = createFakeAppendPort();
    const receipt = await createHouseholdEventWriter({ port }).append(record);
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_REQUIRED");
    expect(port.ledger()).toHaveLength(0);
  });

  it("defaults to TEST/SIMULATION and refuses a production connector in that mode", async () => {
    const record = canonical(productionIntent);
    const release = authorizeAppend({
      record,
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "confirmed",
    });
    expect(release.granted).toBe(true);
    if (!release.granted) return;
    expect(release.target).toBe("TEST_SIMULATION");
    expect(release.writerMode).toBe("PROPOSE");

    const pretendProduction = {
      portId: "pretend-production",
      provenance: "PRODUCTION" as const,
      append: async () => {
        throw new Error("must never be called");
      },
    };
    const receipt = await createHouseholdEventWriter({
      mode: release.writerMode,
      port: pretendProduction,
    }).append(record, release.authorization);
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("PRODUCTION_WRITE_DISABLED");
  });

  it("refuses PRODUCTION_WRITE when no credential exists", () => {
    const record = canonical(productionIntent);
    expect(productionWriteAvailable(undefined)).toBe(false);
    expect(productionWriteAvailable("")).toBe(false);
    expect(
      authorizeAppend({
        record,
        target: "PRODUCTION_WRITE",
        decision: "APPROVED",
        approvedBy: "James",
        evidenceSource: "EXPLICIT_USER_INPUT",
        evidenceDetail: "confirmed",
        credentialAvailable: productionWriteAvailable(undefined),
      }),
    ).toMatchObject({ granted: false, refusal: { code: "PRODUCTION_WRITE_UNAVAILABLE" } });

    expect(createAirtableAppendPort()).toMatchObject({ ok: false, reason: "CONNECTOR_ABSENT" });
  });

  it("constructs the production port from the canonical Airtable REST transport", async () => {
    const record = canonical(productionIntent);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ records: [{ id: "rec-event-1" }] }),
      text: async () => "",
    }) as Response);
    const result = createAirtableAppendPort({
      baseId: "app-food-os",
      credential: "test-token",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.port.provenance).toBe("PRODUCTION");
    const ack = await result.port.append(record);
    expect(ack.connectorRecordId).toBe("rec-event-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("tbluDjPNJ3hxUpWxN");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("refuses to release a Test record as production and refuses to append it at all", async () => {
    const testRecord = canonical({ ...productionIntent, recordClass: "Test" });
    expect(
      authorizeAppend({
        record: testRecord,
        target: "PRODUCTION_WRITE",
        decision: "APPROVED",
        approvedBy: "James",
        evidenceSource: "EXPLICIT_USER_INPUT",
        evidenceDetail: "confirmed",
        credentialAvailable: true,
      }),
    ).toMatchObject({ granted: false, refusal: { code: "TEST_RECORD_REFUSED" } });

    const port = createFakeAppendPort();
    const receipt = await createHouseholdEventWriter({ port }).append(testRecord, {
      authorizationId: "AUTH-TEST",
      decision: "APPROVED",
      approvedBy: "James",
      approvedAt: now(),
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail: "confirmed",
      eventId: testRecord.eventId,
      payloadHash: testRecord.payloadHash,
      actionPolicyReference: "PREPARE",
    });
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("TEST_RECORD_REFUSED");
    expect(port.ledger()).toHaveLength(0);
  });

  it("refuses an approval bound to a different payload and weak evidence", () => {
    const record = canonical(productionIntent);
    expect(
      authorizeAppend({
        record,
        decision: "APPROVED",
        approvedBy: "James",
        evidenceSource: "GUESS" as never,
        evidenceDetail: "hunch",
      }),
    ).toMatchObject({ granted: false, refusal: { code: "INSUFFICIENT_EVIDENCE" } });
    expect(
      authorizeAppend({
        record,
        decision: "DEFERRED",
        approvedBy: "James",
        evidenceSource: "EXPLICIT_USER_INPUT",
        evidenceDetail: "later",
      }),
    ).toMatchObject({ granted: false, refusal: { code: "AUTHORIZATION_NOT_GRANTED" } });
  });

  it("cannot append unsupported event types or invalid signs", () => {
    for (const eventType of ["Confirmation", "Transfer", "Substitution", "Unavailable", "Other"] as const) {
      const result = prepareAppend({ ...productionIntent, eventType }, { now });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rejection.code).toBe("UNSUPPORTED_EVENT_TYPE");
    }
    const wrongSign = prepareAppend({ ...productionIntent, quantityDelta: 50 }, { now });
    expect(wrongSign.ok).toBe(false);
    if (!wrongSign.ok) expect(wrongSign.rejection.code).toBe("QUANTITY_DIRECTION_CONFLICT");
  });

  it("exposes no destructive or inventory verb on any port", () => {
    const port = createFakeAppendPort();
    const verbs = Object.keys(port).filter((k) => typeof (port as unknown as Record<string, unknown>)[k] === "function");
    expect(verbs.sort()).toEqual(["append", "ledger"]);
    for (const forbidden of [
      "update",
      "delete",
      "remove",
      "upsert",
      "replace",
      "patch",
      "setInventory",
      "updateInventory",
      "writeInventory",
    ]) {
      expect((port as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it("preview never writes, even when a port exists", () => {
    const port = createFakeAppendPort();
    const prepared = prepareAppend(productionIntent, { now });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.wouldWrite).toBe(false);
    expect(prepared.prepared.requiresHumanAuthorization).toBe(true);

    const receipt = createHouseholdEventWriter({ port }).propose(prepared.prepared.record);
    expect(receipt.outcome).toBe("PROPOSED");
    expect(receipt.written).toBe(false);
    expect(receipt.connector).toBeNull();
    expect(port.ledger()).toHaveLength(0);
    expect(port.appended).toHaveLength(0);
  });
});

describe("fail-closed production write: zero network calls", () => {
  it("refuses before any network call is made", async () => {
    const record = canonical(productionIntent);
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: unknown[]) => {
      calls.push(String(args[0]));
      throw new Error("network must never be reached");
    }) as typeof globalThis.fetch;
    try {
      const release = authorizeAppend({
        record,
        target: "PRODUCTION_WRITE",
        decision: "APPROVED",
        approvedBy: "James",
        evidenceSource: "EXPLICIT_USER_INPUT",
        evidenceDetail: "confirmed",
        credentialAvailable: productionWriteAvailable(process.env["AIRTABLE_API_KEY"] ?? null),
      });
      expect(release.granted).toBe(false);

      expect(createAirtableAppendPort()).toMatchObject({ ok: false, reason: "CONNECTOR_ABSENT" });

      const receipt = await createHouseholdEventWriter({ mode: "PRODUCTION_WRITE" }).append(record, {
        authorizationId: "AUTH-X",
        decision: "APPROVED",
        approvedBy: "James",
        approvedAt: now(),
        evidenceSource: "EXPLICIT_USER_INPUT",
        evidenceDetail: "confirmed",
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        actionPolicyReference: "PREPARE",
      });
      expect(receipt.outcome).toBe("REJECTED");
      expect(receipt.rejection?.code).toBe("NO_CONNECTOR");
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
