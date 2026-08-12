/**
 * ISOLATED SYNTHETIC EVIDENCE — not production operational evidence.
 *
 * One vertical slice composing the existing modules:
 *   production-adapter boundary → State Engine replay → QUANTITY REQUIREMENTS
 *   handoff → quantity adapter → existing procurement aggregation.
 * SYNTHETIC mode only, explicit synthetic provenance, no Airtable connection,
 * no writes, no dispatch.
 */
import { describe, expect, it } from "vitest";

import { runSourceToBasketSlice } from "./harness";
import {
  eventRow,
  sliceNow,
  sliceProvenance,
  sliceRows,
  sliceScope,
  sliceTargets,
} from "./fixtures";
import {
  createAirtableProductionPort,
  createFakeAirtableRowSource,
} from "../production-adapter/airtable-port";
import type { AirtableRow } from "../production-adapter/airtable-port";
import { shadowCatalogue } from "../procurement/fixtures";

function port(rows: AirtableRow[]) {
  return createAirtableProductionPort({
    source: createFakeAirtableRowSource({
      eventRows: rows,
      baseLabel: "synthetic-source-to-basket",
      provenance: sliceProvenance,
    }),
    mode: "SYNTHETIC",
    portId: "fake-airtable:synthetic-source-to-basket",
  });
}

const run = (rows: AirtableRow[] = sliceRows, scope = sliceScope) =>
  runSourceToBasketSlice({
    port: port(rows),
    scope,
    targets: sliceTargets,
    catalogue: shadowCatalogue,
    now: sliceNow,
  });

describe("source → basket vertical slice (synthetic)", () => {
  it("(1) synthetic Airtable-shaped source reaches procurement with no static INVENTORY fallback", async () => {
    const slice = await run();
    expect(slice.loaded.ok).toBe(true);
    expect(slice.loaded.writable).toBe(false);
    expect(slice.loaded.targets).toEqual([]); // targets never come from the source
    expect(slice.plan.executed).toBe(true);
    expect(slice.plan.eligibleForProcurement).toBe(true);
    expect(slice.plan.rejections.map((r) => r.code)).not.toContain("MISSING_REPLAY_SNAPSHOT");

    const oats = slice.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    // 1000 received − 400 consumed = 600 replayed on hand; target 2000.
    expect(oats.onHandQuantity).toBe(600);
    expect(oats.requiredQuantity).toBe(1400);
    // Absent from the replayed state entirely → on-hand 0, still procured.
    const eggs = slice.plan.requirements.find((r) => r.itemKey === "eggs-large")!;
    expect(eggs.onHandQuantity).toBe(0);
    expect(eggs.sourceEventIds).toEqual([]);
    expect(slice.basket.lines.map((l) => l.itemKey)).toEqual([
      "eggs-large",
      "milk-whole",
      "oats-rolled",
    ]);
  });

  it("(2) replay identity and source Event IDs survive into requirements and basket lines", async () => {
    const slice = await run();
    expect(slice.plan.snapshotId).toBe(slice.snapshot!.snapshotId);
    expect(slice.plan.replayId).toBe(slice.snapshot!.replayId);
    expect(slice.plan.replayTimestamp).toBe(slice.snapshot!.replayTimestamp);
    expect(slice.basket.snapshotId).toBe(slice.snapshot!.snapshotId);
    expect(slice.basket.replayId).toBe(slice.snapshot!.replayId);
    expect(slice.basket.replayTimestamp).toBe(slice.snapshot!.replayTimestamp);
    expect(slice.basket.planId).toBe(slice.plan.planId);

    const oatsLine = slice.basket.lines.find((l) => l.itemKey === "oats-rolled")!;
    expect(oatsLine.sourceEventIds).toEqual(["SYN-EVT-1", "SYN-EVT-2"]);
    const oatsReq = slice.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    expect(oatsLine.requirementIds).toEqual([oatsReq.requirementId]);
    expect(slice.sourceEventIds.sort()).toEqual(["SYN-EVT-1", "SYN-EVT-2", "SYN-EVT-3"]);
  });

  it("(3) identical duplicate Event ID is idempotent end-to-end", async () => {
    const base = await run();
    const duplicated = await run([...sliceRows, { ...sliceRows[1]!, id: "recSYN2-redelivered" }]);
    expect(duplicated.snapshot!.snapshotId).toBe(base.snapshot!.snapshotId);
    expect(duplicated.snapshot!.replayId).toBe(base.snapshot!.replayId);
    expect(duplicated.plan.planId).toBe(base.plan.planId);
    expect(duplicated.basket.basketId).toBe(base.basket.basketId);
    expect(duplicated.plan.requirements).toEqual(base.plan.requirements);
    // Exactly one mutation: 400g consumed once, not twice.
    expect(
      duplicated.plan.requirements.find((r) => r.itemKey === "oats-rolled")!.onHandQuantity,
    ).toBe(600);
    expect(duplicated.basket.lines).toEqual(base.basket.lines);
    expect(duplicated.dispatched).toBe(false);
  });

  it("(4) reused Event ID with a changed payload blocks quantity and procurement", async () => {
    const conflicting = eventRow("recSYN2-conflict", {
      "Event ID": "SYN-EVT-2",
      "Event type": "Consumption",
      "Occurred at": "2026-08-02T08:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 900,
      Unit: "g",
    });
    const slice = await run([...sliceRows, conflicting]);
    // The boundary quarantines the item before replay even sees the conflict.
    expect(slice.loaded.quarantinedItemKeys).toEqual(["oats-rolled"]);
    expect(slice.loaded.rejections.map((r) => r.code)).toContain("DUPLICATE_EVENT_ID");
    expect(slice.plan.executed).toBe(false);
    expect(slice.plan.eligibleForProcurement).toBe(false);
    expect(slice.plan.requirements).toEqual([]);
    expect(slice.basket.lines).toEqual([]);
    expect(slice.basket.complete).toBe(false);
    expect(slice.basket.readyForApproval).toBe(false);
    expect(slice.basket.dispatched).toBe(false);
    expect(slice.dispatched).toBe(false);
  });

  it("(4b) a conflicted item can be isolated without blocking unrelated procurement", async () => {
    const conflicting = eventRow("recSYN2-conflict", {
      "Event ID": "SYN-EVT-2",
      "Event type": "Consumption",
      "Occurred at": "2026-08-02T08:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 900,
      Unit: "g",
    });
    const slice = await runSourceToBasketSlice({
      port: port([...sliceRows, conflicting]),
      scope: sliceScope,
      targets: sliceTargets,
      catalogue: shadowCatalogue,
      now: sliceNow,
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(slice.plan.requirements.map((r) => r.itemKey)).not.toContain("oats-rolled");
    expect(slice.basket.lines.map((l) => l.itemKey)).toEqual(["eggs-large", "milk-whole"]);
    expect(slice.basket.dispatched).toBe(false);
  });

  it("(5) Record class = Test is excluded before ID-conflict handling", async () => {
    const clean = await run();
    const testRow = eventRow("recSYN-TEST", {
      "Event ID": "SYN-EVT-2", // reuses a Production Event ID, different payload
      "Event type": "Consumption",
      "Occurred at": "2026-08-02T08:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 999,
      Unit: "g",
      "Record class": "Test",
    });
    const withTest = await run([...sliceRows, testRow]);
    expect(withTest.loaded.quarantinedItemKeys).toEqual([]);
    expect(withTest.loaded.rejections.map((r) => r.code)).not.toContain("DUPLICATE_EVENT_ID");
    expect(withTest.plan.requirements).toEqual(clean.plan.requirements);
    expect(withTest.basket.lines).toEqual(clean.basket.lines);
    expect(withTest.snapshot!.snapshotId).toBe(clean.snapshot!.snapshotId);
  });

  it("(6) synthetic provenance is refused in PRODUCTION_READ_ONLY mode", async () => {
    const productionScope = { ...sliceScope, mode: "PRODUCTION_READ_ONLY" as const };
    // Port declares SYNTHETIC → mode guard fires first.
    const modeMismatch = await run(sliceRows, productionScope);
    expect(modeMismatch.loaded.ok).toBe(false);
    expect(modeMismatch.loaded.rejections[0]!.code).toBe("MODE_MISMATCH");

    // Port claims production, but the provenance is explicitly synthetic.
    const lying = createAirtableProductionPort({
      source: createFakeAirtableRowSource({
        eventRows: sliceRows,
        baseLabel: "synthetic-source-to-basket",
        provenance: sliceProvenance,
      }),
      mode: "PRODUCTION_READ_ONLY",
      portId: "fake-airtable:pretending-production",
    });
    const slice = await runSourceToBasketSlice({
      port: lying,
      scope: productionScope,
      targets: sliceTargets,
      catalogue: shadowCatalogue,
      now: sliceNow,
    });
    expect(slice.loaded.ok).toBe(false);
    expect(slice.loaded.rejections[0]!.code).toBe("PROVENANCE_CONTAMINATION");
    expect(slice.snapshot).toBeNull();
    // Refusal must not fall back to static inventory.
    expect(slice.plan.rejections[0]!.code).toBe("MISSING_REPLAY_SNAPSHOT");
    expect(slice.plan.requirements).toEqual([]);
    expect(slice.basket.lines).toEqual([]);
    expect(slice.basket.dispatched).toBe(false);
  });

  it("(7) procurement aggregation is the existing implementation and still needs approval", async () => {
    const slice = await run();
    const oats = slice.plan.requirements.find((r) => r.itemKey === "oats-rolled")!;
    const oatsLine = slice.basket.lines.find((l) => l.itemKey === "oats-rolled")!;
    // Pack rounding / catalogue choice are the existing procurement behaviour.
    expect(oatsLine.packCount).toBe(Math.ceil(oats.requiredQuantity / oatsLine.packSize));
    expect(oatsLine.orderedQuantity).toBe(oatsLine.packCount * oatsLine.packSize);
    expect(oatsLine.requirementCount).toBe(1);
    expect(slice.basket.coverage.unsourcedItemKeys).toEqual([]);
    expect(slice.basket.coverage.complete).toBe(true);
    expect(slice.basket.requiresHumanApproval).toBe(true);
    expect(slice.basket.dispatched).toBe(false);
    expect(slice.requiresHumanApproval).toBe(true);
    expect(slice.dispatched).toBe(false);

    // Deterministic repeat of the whole slice.
    const again = await run();
    expect(again.basket).toEqual(slice.basket);
    expect(again.plan).toEqual(slice.plan);
  });
});

/**
 * Nearest unproven contracts at this boundary: reconciliation status carried
 * verbatim into the QUANTITY REQUIREMENTS handoff, and source rows that cannot
 * be mapped deterministically. Neither may ever become a silent stock change.
 */
describe("source-row integrity through the handoff (synthetic)", () => {
  it("(8) reconciliation status is carried verbatim into the handoff and plan", async () => {
    const clean = await run();
    expect(clean.snapshot!.reconciliationStatus).toBe("CLEAN");
    expect(clean.handoff!.reconciliationStatus).toBe("CLEAN");
    expect(clean.handoff!.readyForQuantityRun).toBe(true);
    expect(clean.plan.reconciliationStatus).toBe("CLEAN");
    expect(clean.handoff!.snapshotId).toBe(clean.snapshot!.snapshotId);
    expect(clean.handoff!.replayId).toBe(clean.snapshot!.replayId);
    expect(clean.handoff!.replayTimestamp).toBe(clean.snapshot!.replayTimestamp);

    // A replay-level conflict (two Production payloads under one Event ID that
    // reach the engine) must surface as BLOCKED, not be smoothed over.
    const conflicting = eventRow("recSYN2-conflict", {
      "Event ID": "SYN-EVT-2",
      "Event type": "Consumption",
      "Occurred at": "2026-08-02T08:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 900,
      Unit: "g",
    });
    const blocked = await run([...sliceRows, conflicting]);
    expect(blocked.plan.reconciliationStatus).toBe(blocked.handoff!.reconciliationStatus);
    expect(blocked.plan.eligibleForProcurement).toBe(false);
  });

  it("(9) unsupported source rows stay explicit and never become a stock change", async () => {
    const clean = await run();
    const confirmation = eventRow("recSYN-CONFIRM", {
      "Event ID": "SYN-EVT-90",
      "Event type": "Confirmation",
      "Occurred at": "2026-08-03T08:00:00.000Z",
      Item: "oats-rolled",
      "Quantity delta": 5000,
      Unit: "g",
    });
    const slice = await run([...sliceRows, confirmation]);
    const rejection = slice.loaded.rejections.find((r) => r.eventId === "SYN-EVT-90")!;
    expect(rejection.code).toBe("UNSUPPORTED_EVENT_TYPE");
    expect(rejection.fatal).toBe(false);
    // Informational only: the item is NOT quarantined and planning continues.
    expect(slice.loaded.quarantinedItemKeys).toEqual([]);
    expect(slice.loaded.openingEvents.map((e) => e.eventId)).not.toContain("SYN-EVT-90");
    expect(slice.plan.requirements).toEqual(clean.plan.requirements);
    expect(slice.basket.lines).toEqual(clean.basket.lines);
  });

  it("(10) malformed source rows are rejected explicitly and quarantine only their item", async () => {
    const malformed = [
      // Quantity present, unit absent — a unit is never invented.
      eventRow("recSYN-NOUNIT", {
        "Event ID": "SYN-EVT-91",
        "Event type": "Receipt",
        "Occurred at": "2026-08-03T08:00:00.000Z",
        Item: "milk-whole",
        "Quantity delta": 2,
        Unit: "",
      }),
      // Correction with no numeric `State after` — no absolute state derivable.
      eventRow("recSYN-BADCORR", {
        "Event ID": "SYN-EVT-92",
        "Event type": "Correction",
        "Occurred at": "2026-08-03T09:00:00.000Z",
        Item: "eggs-large",
        "State after": "about a dozen",
        Unit: "count",
      }),
    ];
    const slice = await runSourceToBasketSlice({
      port: port([...sliceRows, ...malformed]),
      scope: sliceScope,
      targets: sliceTargets,
      catalogue: shadowCatalogue,
      now: sliceNow,
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    const codes = slice.loaded.rejections.map((r) => r.code);
    expect(codes).toEqual(["MALFORMED_EVENT", "MALFORMED_EVENT"]);
    expect(slice.loaded.quarantinedItemKeys).toEqual(["eggs-large", "milk-whole"]);
    expect(slice.loaded.openingEvents.map((e) => e.eventId)).toEqual([
      "SYN-EVT-1",
      "SYN-EVT-2",
      "SYN-EVT-3",
    ]);
    // Quarantined items are withheld from procurement; unrelated items proceed.
    expect(slice.plan.requirements.map((r) => r.itemKey)).toEqual(["oats-rolled"]);
    expect(slice.plan.rejections.filter((r) => r.code === "ITEM_ISOLATED")).toHaveLength(2);
    expect(slice.basket.lines.map((l) => l.itemKey)).toEqual(["oats-rolled"]);
    expect(slice.basket.dispatched).toBe(false);
  });

  it("(11) legacy/invented field names are refused, never partially accepted", async () => {
    const legacy: AirtableRow = {
      id: "recSYN-LEGACY",
      fields: {
        "Event ID": "SYN-EVT-93",
        "Event Type": "Receipt", // invented casing
        "Item Key": "oats-rolled", // invented field
        Quantity: 5000,
        Unit: "g",
        "Occurred at": "2026-08-03T10:00:00.000Z",
        Item: "oats-rolled",
        "Record class": "Production",
      },
    };
    const slice = await run([...sliceRows, legacy]);
    const rejection = slice.loaded.rejections.find((r) => r.eventId === "SYN-EVT-93")!;
    expect(rejection.code).toBe("LEGACY_FIELD_SCHEMA");
    expect(slice.loaded.openingEvents.map((e) => e.eventId)).not.toContain("SYN-EVT-93");
    expect(slice.loaded.quarantinedItemKeys).toEqual(["oats-rolled"]);
    expect(slice.plan.executed).toBe(false);
    expect(slice.basket.lines).toEqual([]);
  });
});
