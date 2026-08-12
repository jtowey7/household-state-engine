import { describe, expect, it } from "vitest";

import {
  canonicaliseAppend,
  createAirtableAppendPort,
  createFakeAppendPort,
  createHouseholdEventWriter,
  intentForProjectedEvent,
  isCanonicalAppendRecord,
  proposeAppends,
} from "./index";
import type { AppendAuthorization, CanonicalAppendRecord } from "./types";
import type { AppendIntent } from "../write-boundary/types";
import { SALMON_ITEM } from "../write-boundary/salmon-scenario";
import { mapHouseholdEventRows } from "../production-adapter/airtable-port";
import { replayEvents } from "../state-engine/engine";
import { salmonOpeningRow } from "../write-boundary/salmon-scenario";

const now = () => "2026-08-12T08:00:00.000Z";

/** The real Tuesday salmon fact, as a SYNTHETIC intent. Never written. */
const salmonConsumption: AppendIntent = {
  eventType: "Consumption",
  item: SALMON_ITEM,
  occurredAt: "2026-08-11T18:30:00.000Z",
  quantityDelta: -780,
  unit: "g",
  source: "Planned meal completion",
  actor: "Food OS state engine",
  entityType: "Inventory item",
  entityReference: "INV-SALMON-780G",
  evidence: "James confirmed the Tuesday salmon was eaten",
  confidence: "High",
  stateBefore: 780,
  recordClass: "Production",
};

function canonical(intent: AppendIntent = salmonConsumption): CanonicalAppendRecord {
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture failed to canonicalise: ${result.rejection.code}`);
  return result.record;
}

function approvalFor(
  record: CanonicalAppendRecord,
  overrides: Partial<AppendAuthorization> = {},
): AppendAuthorization {
  return {
    authorizationId: "AUTH-SALMON-1",
    decision: "APPROVED",
    approvedBy: "James",
    approvedAt: "2026-08-12T07:55:00.000Z",
    evidenceSource: "EXPLICIT_USER_INPUT",
    evidenceDetail: "James stated the Tuesday salmon was eaten.",
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    actionPolicyReference: "ACTION POLICY: Record a routine consumption event = PREPARE",
    ...overrides,
  };
}

describe("append-only surface", () => {
  it("exposes exactly one write verb and no mutation verbs", () => {
    const port = createFakeAppendPort();
    const verbs = Object.keys(port).filter((k) => typeof (port as never)[k] === "function");
    expect(verbs).toEqual(["append"]);
    for (const forbidden of ["update", "delete", "replace", "upsert", "patch", "destroy", "set"]) {
      expect(port).not.toHaveProperty(forbidden);
    }
  });

  it("has no INVENTORY verb anywhere on the writer or its receipts", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    expect(Object.keys(writer).sort()).toEqual(["append", "mode", "propose", "receipts"]);
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.table).toBe("HOUSEHOLD EVENTS");
    expect(receipt.inventoryMutated).toBe(false);
    // Consumption is represented ONLY as a new event row.
    expect(record.row["Event type"]).toBe("Consumption");
    expect(record.row["Quantity delta"]).toBe(-780);
  });

  it("accepts only canonical records", async () => {
    const writer = createHouseholdEventWriter({ port: createFakeAppendPort() });
    const forged = {
      eventId: "EVT-FORGED",
      payloadHash: "deadbeef",
      row: { "Event ID": "EVT-FORGED" },
    } as unknown as CanonicalAppendRecord;
    expect(isCanonicalAppendRecord(forged)).toBe(false);
    const receipt = await writer.append(forged, approvalFor(canonical()));
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("NOT_CANONICAL");
  });
});

describe("authorization gate", () => {
  it("refuses an append with no authorization object", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const receipt = await writer.append(canonical());
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_REQUIRED");
    expect(receipt.written).toBe(false);
    expect(port.appended).toHaveLength(0);
  });

  it("refuses a REJECTED or DEFERRED decision", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    for (const decision of ["REJECTED", "DEFERRED"] as const) {
      const receipt = await writer.append(record, approvalFor(record, { decision }));
      expect(receipt.rejection?.code).toBe("AUTHORIZATION_NOT_GRANTED");
    }
    expect(port.appended).toHaveLength(0);
  });

  it("refuses an approval bound to a different payload", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    const other = canonical({ ...salmonConsumption, quantityDelta: -100 });
    const receipt = await writer.append(record, approvalFor(other));
    expect(receipt.rejection?.code).toBe("AUTHORIZATION_SCOPE_MISMATCH");
    expect(port.appended).toHaveLength(0);
  });

  it("requires explicit user input or strong transaction evidence", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    const weak = await writer.append(
      record,
      approvalFor(record, { evidenceSource: "INFERRED" as never }),
    );
    expect(weak.rejection?.code).toBe("INSUFFICIENT_EVIDENCE");

    const strong = await writer.append(
      record,
      approvalFor(record, { evidenceSource: "STRONG_TRANSACTION_EVIDENCE" }),
    );
    expect(strong.outcome).toBe("APPENDED_SYNTHETIC");
  });
});

describe("production mode gate", () => {
  it("defaults to PROPOSE and will not call a production connector", async () => {
    const writer = createHouseholdEventWriter({
      port: { portId: "pretend", provenance: "PRODUCTION", append: async () => {
        throw new Error("must never be called");
      } },
    });
    expect(writer.mode).toBe("PROPOSE");
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.rejection?.code).toBe("PRODUCTION_WRITE_DISABLED");
    expect(receipt.written).toBe(false);
  });

  it("refuses a synthetic port for a production write, with no fallback", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("SYNTHETIC_PROVENANCE_REFUSED");
    expect(port.appended).toHaveLength(0);
  });

  it("refuses a production write with no connector at all", async () => {
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE" });
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.rejection?.code).toBe("NO_CONNECTOR");
  });

  it("cannot construct the Airtable connector in this workspace", () => {
    const result = createAirtableAppendPort();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("CONNECTOR_ABSENT");
    expect(result.detail).toContain("baseId");
  });

  it("the fake port cannot claim production provenance", () => {
    const port = createFakeAppendPort({ portId: "totally-real" });
    expect(port.provenance).toBe("SYNTHETIC");
    // No constructor argument exists that changes provenance.
    const forced = createFakeAppendPort({ provenance: "PRODUCTION" } as never);
    expect(forced.provenance).toBe("SYNTHETIC");
  });
});

describe("record class and identity", () => {
  it("refuses Test-class records", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical({ ...salmonConsumption, recordClass: "Test" });
    expect(record.eventId.startsWith("TEST-")).toBe(true);
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.rejection?.code).toBe("TEST_RECORD_REFUSED");
    expect(port.appended).toHaveLength(0);
  });

  it("derives a canonical Event ID that is stable across clocks", () => {
    const a = canonicaliseAppend(salmonConsumption, { now });
    const b = canonicaliseAppend(salmonConsumption, { now: () => "2027-01-01T00:00:00.000Z" });
    if (!a.ok || !b.ok) throw new Error("canonicalisation failed");
    expect(b.record.eventId).toBe(a.record.eventId);
    expect(b.record.payloadHash).toBe(a.record.payloadHash);
    expect(b.record.row["Recorded at"]).not.toBe(a.record.row["Recorded at"]);
  });

  it("treats an identical second append as an idempotent no-op", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    const first = await writer.append(record, approvalFor(record));
    const second = await writer.append(record, approvalFor(record));
    expect(first.outcome).toBe("APPENDED_SYNTHETIC");
    expect(second.outcome).toBe("DUPLICATE_NOOP");
    expect(second.written).toBe(false);
    expect(port.appended).toHaveLength(1);
  });

  it("treats a reused Event ID with a changed payload as a hard conflict", async () => {
    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    await writer.append(record, approvalFor(record));
    // Forge the original identity onto a different payload.
    const mutated = canonical({ ...salmonConsumption, quantityDelta: -100 });
    const forged: CanonicalAppendRecord = {
      ...mutated,
      eventId: record.eventId,
      row: { ...mutated.row, "Event ID": record.eventId },
    };
    const receipt = await writer.append(forged, approvalFor(forged));
    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("REUSED_EVENT_ID_PAYLOAD_CONFLICT");
    expect(port.appended).toHaveLength(1);
    expect(port.appended[0]?.row["Quantity delta"]).toBe(-780);
  });
});

describe("receipts and provenance", () => {
  it("preserves evidence, approver and connector provenance", async () => {
    const port = createFakeAppendPort({ portId: "fake-1" });
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.connector).toEqual({
      portId: "fake-1",
      provenance: "SYNTHETIC",
      connectorRecordId: "synthetic-1",
    });
    expect(receipt.authorization).toEqual({
      authorizationId: "AUTH-SALMON-1",
      approvedBy: "James",
      evidenceSource: "EXPLICIT_USER_INPUT",
      actionPolicyReference: "ACTION POLICY: Record a routine consumption event = PREPARE",
    });
    expect(record.row.Evidence).toContain("James confirmed");
    expect(record.row.Source).toBe("Planned meal completion");
    expect(record.row.Actor).toBe("Food OS state engine");
  });

  it("returns a deterministic receipt id for the same inputs", async () => {
    const build = async () => {
      const writer = createHouseholdEventWriter({ port: createFakeAppendPort({ portId: "p" }) });
      const record = canonical();
      return writer.append(record, approvalFor(record));
    };
    const a = await build();
    const b = await build();
    expect(a.receiptId).toBe(b.receiptId);
    expect(a.eventId).toBe(b.eventId);
  });

  it("reports a connector failure instead of pretending success", async () => {
    const port = createFakeAppendPort({ failWith: "network down" });
    const writer = createHouseholdEventWriter({ port });
    const record = canonical();
    const receipt = await writer.append(record, approvalFor(record));
    expect(receipt.rejection?.code).toBe("CONNECTOR_FAILED");
    expect(receipt.written).toBe(false);
    // The failed event ID is NOT recorded as written, so a retry is allowed.
    const retry = await writer.append(canonical(), approvalFor(canonical()));
    expect(retry.rejection?.code).toBe("CONNECTOR_FAILED");
  });
});

describe("Tuesday salmon regression (synthetic)", () => {
  it("refuses without authorization and produces one canonical event with it", async () => {
    const port = createFakeAppendPort();
    const unauthorised = createHouseholdEventWriter({ port });
    const record = canonical();

    const refused = await unauthorised.append(record);
    expect(refused.outcome).toBe("REJECTED");
    expect(refused.rejection?.code).toBe("AUTHORIZATION_REQUIRED");
    expect(port.appended).toHaveLength(0);

    const authorised = createHouseholdEventWriter({ port });
    const first = await authorised.append(record, approvalFor(record));
    const second = await authorised.append(record, approvalFor(record));
    expect(first.outcome).toBe("APPENDED_SYNTHETIC");
    expect(second.outcome).toBe("DUPLICATE_NOOP");
    expect(port.appended).toHaveLength(1);
    expect(port.appended[0]?.row.Item).toBe(SALMON_ITEM);
    expect(port.appended[0]?.row["Quantity delta"]).toBe(-780);
    expect(port.appended[0]?.row.Unit).toBe("g");
  });

  it("replays the appended event to 0 g of salmon", () => {
    const record = canonical();
    const batch = mapHouseholdEventRows([
      salmonOpeningRow,
      { id: "recDRAFT1", fields: { ...record.row } },
      // Duplicate delivery of the same immutable event.
      { id: "recDRAFT2", fields: { ...record.row } },
    ]);
    const snapshot = replayEvents(batch.events, { now });
    const salmon = snapshot.items.find((i) => i.itemKey === SALMON_ITEM);
    expect(salmon?.quantity).toBe(0);
    expect(salmon?.unit).toBe("g");
    expect(salmon?.blocked).toBe(false);
  });
});

describe("PROPOSE_APPEND", () => {
  it("proposes canonical rows without writing anything", () => {
    const proposals = proposeAppends(
      [
        {
          eventId: "PROJ-1",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: SALMON_ITEM,
          occurredAt: "2026-08-11T18:30:00.000Z",
          payload: { quantity: -780, unit: "g", note: "meal:tuesday-dinner completed" },
        },
      ],
      { now },
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.receipt?.outcome).toBe("PROPOSED");
    expect(proposals[0]?.receipt?.written).toBe(false);
    expect(proposals[0]?.receipt?.connector).toBeNull();
    expect(proposals[0]?.record?.row["Event type"]).toBe("Consumption");
    expect(proposals[0]?.requiresHumanAuthorization).toBe(true);
  });

  it("never re-proposes an event already present in the source", () => {
    const proposals = proposeAppends(
      [
        {
          eventId: "EVT-EXISTING",
          recordClass: "Production",
          eventType: "ITEM_STOCK_DELTA",
          itemKey: SALMON_ITEM,
          occurredAt: "2026-08-11T08:30:00.000Z",
          payload: { quantity: 780, unit: "g" },
        },
      ],
      { now, existingEventIds: ["EVT-EXISTING"] },
    );
    expect(proposals).toHaveLength(0);
  });

  it("maps a stock set to a Correction and refuses an unquantified event", () => {
    const correction = intentForProjectedEvent(
      {
        eventId: "PROJ-2",
        recordClass: "Production",
        eventType: "ITEM_STOCK_SET",
        itemKey: SALMON_ITEM,
        occurredAt: "2026-08-12T07:00:00.000Z",
        payload: { quantity: 0, unit: "g" },
      },
      { actor: "James", source: "Household correction" },
    );
    expect(correction?.eventType).toBe("Correction");
    expect(correction?.stateAfter).toBe(0);

    const none = intentForProjectedEvent(
      {
        eventId: "PROJ-3",
        recordClass: "Production",
        eventType: "ITEM_REMOVED",
        itemKey: SALMON_ITEM,
        occurredAt: "2026-08-12T07:00:00.000Z",
        payload: {},
      },
      { actor: "James", source: "Household correction" },
    );
    expect(none).toBeNull();
  });
});
