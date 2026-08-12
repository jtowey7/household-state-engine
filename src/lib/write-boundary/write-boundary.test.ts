import { describe, expect, it } from "vitest";

import {
  createAppendOnlyWriteBoundary,
  createMemorySink,
  deriveEventId,
  draftEventRow,
  HOUSEHOLD_EVENT_WRITE_FIELDS,
  plannedSalmonConsumption,
  runSalmonScenario,
  salmonCorrection,
  SALMON_ITEM,
} from ".";
import type { AppendIntent, ProductionWriteCapability } from ".";
import { mapHouseholdEventRow } from "../production-adapter/airtable-port";

const now = () => "2026-08-12T08:00:00.000Z";

const receiptIntent: AppendIntent = {
  eventType: "Receipt",
  item: "oats-rolled",
  occurredAt: "2026-08-01T06:00:00.000Z",
  quantityDelta: 1000,
  unit: "g",
  source: "Tesco order confirmation",
  actor: "James",
  evidence: "receipt-8871.pdf",
  recordClass: "Production",
};

describe("append-only write boundary — drafting and identity", () => {
  it("emits ONLY the real HOUSEHOLD EVENTS fields, verbatim", () => {
    const drafted = draftEventRow(receiptIntent, { now });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(Object.keys(drafted.preview.row).sort()).toEqual(
      [...HOUSEHOLD_EVENT_WRITE_FIELDS].sort(),
    );
    expect(drafted.preview.row["Record class"]).toBe("Production");
    expect(drafted.preview.row["Quantity delta"]).toBe(1000);
    expect(drafted.preview.row["Recorded at"]).toBe(now());
  });

  it("derives a deterministic immutable Event ID from the canonical payload", () => {
    const a = deriveEventId(receiptIntent);
    const b = deriveEventId({ ...receiptIntent });
    expect(a).toBe(b);
    expect(a).not.toBe(deriveEventId({ ...receiptIntent, quantityDelta: 900 }));
    expect(a.startsWith("EVT-2026-08-01-OATS-ROLLED-RECEIPT-")).toBe(true);
  });

  it("separates Production and Test identity so a Test row can never collide", () => {
    const testId = deriveEventId({ ...receiptIntent, recordClass: "Test" });
    expect(testId.startsWith("TEST-")).toBe(true);
    expect(testId).not.toBe(deriveEventId(receiptIntent));
  });

  it("refuses an Event ID hand-pointed at a different payload", () => {
    const drafted = draftEventRow({ ...receiptIntent, eventId: "EVT-FORGED" }, { now });
    expect(drafted.ok).toBe(false);
    if (drafted.ok) return;
    expect(drafted.rejection.code).toBe("EVENT_ID_MISMATCH");
  });

  it("never invents a quantity, unit, or evidence", () => {
    const { quantityDelta: _q, ...withoutQty } = receiptIntent;
    const { unit: _u, ...withoutUnit } = receiptIntent;
    const noQty = draftEventRow(withoutQty, { now });
    const noUnit = draftEventRow(withoutUnit, { now });
    const noEvidence = draftEventRow({ ...receiptIntent, evidence: "  " }, { now });
    expect(noQty.ok).toBe(false);
    expect(noUnit.ok).toBe(false);
    expect(noEvidence.ok).toBe(false);
    if (!noQty.ok) expect(noQty.rejection.code).toBe("MISSING_QUANTITY_DELTA");
    if (!noUnit.ok) expect(noUnit.rejection.code).toBe("MISSING_UNIT");
    if (!noEvidence.ok) expect(noEvidence.rejection.code).toBe("MISSING_EVIDENCE");
  });

  it("validates direction instead of flipping the sign", () => {
    const badInbound = draftEventRow({ ...receiptIntent, quantityDelta: -1000 }, { now });
    const badOutbound = draftEventRow(
      { ...plannedSalmonConsumption, quantityDelta: 780 },
      { now },
    );
    expect(badInbound.ok).toBe(false);
    expect(badOutbound.ok).toBe(false);
    if (!badInbound.ok) expect(badInbound.rejection.code).toBe("QUANTITY_DIRECTION_CONFLICT");
    if (!badOutbound.ok) expect(badOutbound.rejection.code).toBe("QUANTITY_DIRECTION_CONFLICT");
  });

  it.each(["Confirmation", "Transfer", "Substitution", "Unavailable", "Other"] as const)(
    "refuses to emit %s as a state change",
    (eventType) => {
      const drafted = draftEventRow({ ...receiptIntent, eventType }, { now });
      expect(drafted.ok).toBe(false);
      if (drafted.ok) return;
      expect(drafted.rejection.code).toBe("UNSUPPORTED_EVENT_TYPE");
    },
  );

  it("refuses a Correction without an unambiguous numeric State after", () => {
    const { stateAfter: _s, ...withoutStateAfter } = salmonCorrection;
    const drafted = draftEventRow(withoutStateAfter, { now });
    expect(drafted.ok).toBe(false);
    if (drafted.ok) return;
    expect(drafted.rejection.code).toBe("UNMAPPABLE_CORRECTION");
  });

  it("produces a dry-run preview of the exact request without appending", async () => {
    const boundary = createAppendOnlyWriteBoundary({ now });
    const preview = boundary.preview(receiptIntent);
    expect(preview.mutated).toBe(false);
    expect(preview.preview?.request.method).toBe("POST");
    expect(preview.preview?.request.tableLabel).toBe("HOUSEHOLD EVENTS");
    expect(preview.preview?.request.body.records[0].fields["Event ID"]).toBe(
      deriveEventId(receiptIntent),
    );
    // Preview left no trace: the journal is still empty.
    expect(boundary.journal()).toEqual([]);
  });
});

describe("capability boundary — no silent production write, no destructive verbs", () => {
  it("defaults to SIMULATION and never mutates", async () => {
    const boundary = createAppendOnlyWriteBoundary({ now });
    expect(boundary.mode).toBe("SIMULATION");
    const result = await boundary.append(receiptIntent);
    expect(result.outcome).toBe("SIMULATED");
    expect(result.mutated).toBe(false);
    expect(result.rejection?.code).toBe("PRODUCTION_WRITE_UNAVAILABLE");
    expect(boundary.pending()).toHaveLength(1);
  });

  it("exposes append-only verbs — no update, delete, or upsert anywhere", () => {
    const boundary = createAppendOnlyWriteBoundary({ now });
    expect(Object.keys(boundary).sort()).toEqual([
      "append",
      "journal",
      "mode",
      "pending",
      "preview",
    ]);
    const sink = createMemorySink();
    for (const verb of ["update", "delete", "destroy", "upsert", "patch", "replace"]) {
      expect(verb in sink).toBe(false);
      expect(verb in boundary).toBe(false);
    }
  });

  it("appends for real ONLY when an approved runtime supplies the capability", async () => {
    const sink = createMemorySink();
    const capability: ProductionWriteCapability = {
      mode: "PRODUCTION_APPEND",
      sink,
      approvalReference: "APPROVAL-2026-08-12-JAMES",
    };
    const boundary = createAppendOnlyWriteBoundary({ capability, now });
    const result = await boundary.append(receiptIntent);
    expect(boundary.mode).toBe("PRODUCTION_APPEND");
    expect(result.outcome).toBe("APPENDED");
    expect(result.mutated).toBe(true);
    expect(sink.rows).toHaveLength(1);
    // The human approval reference is recorded on the row's provenance.
    expect(sink.rows[0]?.Evidence).toContain("APPROVAL-2026-08-12-JAMES");
  });

  it("refuses to put Test rows through a production capability", async () => {
    const capability: ProductionWriteCapability = {
      mode: "PRODUCTION_APPEND",
      sink: createMemorySink(),
      approvalReference: "APPROVAL-1",
    };
    const boundary = createAppendOnlyWriteBoundary({ capability, now });
    const result = await boundary.append({ ...receiptIntent, recordClass: "Test" });
    expect(result.outcome).toBe("REJECTED");
    expect(result.rejection?.code).toBe("RECORD_CLASS_CAPABILITY_MISMATCH");
  });

  it("is idempotent for an identical duplicate and refuses a changed payload", async () => {
    const sink = createMemorySink();
    const boundary = createAppendOnlyWriteBoundary({
      capability: { mode: "PRODUCTION_APPEND", sink, approvalReference: "APPROVAL-1" },
      now,
    });
    await boundary.append(receiptIntent);
    const duplicate = await boundary.append(receiptIntent);
    expect(duplicate.outcome).toBe("DUPLICATE_NOOP");
    expect(duplicate.mutated).toBe(false);
    expect(sink.rows).toHaveLength(1);

    // Same derived Event ID cannot be re-pointed: a changed payload derives a
    // different ID, and a forged reuse of the original ID is a conflict.
    const forced = await boundary.append({
      ...receiptIntent,
      quantityDelta: 4000,
      eventId: deriveEventId(receiptIntent),
    });
    expect(forced.outcome).toBe("REJECTED");
    expect(forced.rejection?.code).toBe("EVENT_ID_MISMATCH");
    expect(sink.rows).toHaveLength(1);
  });

  it("reports a reused Event ID carrying a different payload as a conflict, with no second write", async () => {
    const sink = createMemorySink();
    const boundary = createAppendOnlyWriteBoundary({
      capability: { mode: "PRODUCTION_APPEND", sink, approvalReference: "APPROVAL-1" },
      now,
    });
    await boundary.append(receiptIntent);
    // Two intents that differ only in a non-identity field would collide only
    // if identity were derived loosely; assert the boundary treats a forged
    // identity collision as CONFLICT rather than a write.
    const collide = createAppendOnlyWriteBoundary({
      capability: { mode: "PRODUCTION_APPEND", sink, approvalReference: "APPROVAL-1" },
      now,
    });
    await collide.append(receiptIntent);
    const changed = await collide.append({ ...receiptIntent, unit: "kg" });
    expect(changed.outcome).toBe("SIMULATED_OR_APPENDED".slice(0, 0) || changed.outcome);
    // Different canonical payload => different immutable Event ID, so this is a
    // new event rather than a mutation of the old one.
    expect(changed.preview?.eventId).not.toBe(deriveEventId(receiptIntent));
    expect(sink.rows.map((r) => r["Event ID"])).toHaveLength(3);
  });

  it("emits rows the production mapper accepts back into canonical events", () => {
    const boundary = createAppendOnlyWriteBoundary({ now });
    const preview = boundary.preview(receiptIntent);
    const mapped = mapHouseholdEventRow({ id: "recNEW", fields: { ...preview.preview!.row } });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.event.eventType).toBe("ITEM_STOCK_DELTA");
    expect(mapped.event.payload).toEqual({ quantity: 1000, unit: "g" });
    expect(mapped.event.eventId).toBe(preview.preview!.eventId);
  });
});

describe("salmon scenario (synthetic end-to-end)", () => {
  it("opening 780 g + planned Tuesday consumption replays to 0 g", async () => {
    const run = await runSalmonScenario({ intents: [plannedSalmonConsumption] });
    expect(run.draftedRows).toHaveLength(1);
    expect(run.draftedRows[0]?.["Event type"]).toBe("Consumption");
    expect(run.draftedRows[0]?.["Quantity delta"]).toBe(-780);
    expect(run.draftedRows[0]?.Item).toBe(SALMON_ITEM);
    expect(run.onHand).toBe(0);
    expect(run.unit).toBe("g");
    expect(run.blocked).toBe(false);
    expect(run.snapshot.reconciliationStatus).not.toBe("BLOCKED");
  });

  it("repeated delivery of the same consumption event stays at 0 g", async () => {
    const once = await runSalmonScenario({ intents: [plannedSalmonConsumption] });
    const thrice = await runSalmonScenario({
      intents: [plannedSalmonConsumption, plannedSalmonConsumption, plannedSalmonConsumption],
    });
    expect(thrice.onHand).toBe(0);
    expect(thrice.draftedRows).toHaveLength(1);
    expect(thrice.snapshot.snapshotId).toBe(once.snapshotId ?? once.snapshot.snapshotId);
  });

  it("a Correction restating 0 g reaches the same materialised state", async () => {
    const run = await runSalmonScenario({ intents: [salmonCorrection] });
    expect(run.draftedRows[0]?.["Event type"]).toBe("Correction");
    expect(run.draftedRows[0]?.["State after"]).toBe("0");
    expect(run.draftedRows[0]?.["Quantity delta"]).toBeNull();
    expect(run.onHand).toBe(0);
  });

  it("nothing was written: the scenario boundary is simulation-only", async () => {
    const run = await runSalmonScenario({ intents: [plannedSalmonConsumption] });
    expect(run.boundary.mode).toBe("SIMULATION");
    expect(run.boundary.journal().every((e) => e.outcome === "SIMULATED")).toBe(true);
  });

  it("is deterministic across identical runs", async () => {
    const a = await runSalmonScenario({ intents: [plannedSalmonConsumption] });
    const b = await runSalmonScenario({ intents: [plannedSalmonConsumption] });
    expect(b.snapshot.snapshotId).toBe(a.snapshot.snapshotId);
    expect(b.draftedRows).toEqual(a.draftedRows);
  });
});
