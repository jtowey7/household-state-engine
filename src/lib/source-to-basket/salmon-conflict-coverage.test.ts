/**
 * ISOLATED SYNTHETIC EVIDENCE — not production operational evidence.
 *
 * Red-team pass over the existing source → basket vertical slice:
 *   production-adapter boundary → State Engine replay → QUANTITY REQUIREMENTS
 *   → quantity adapter → existing procurement aggregation.
 *
 * Adds the salmon 780g burn-down case and, critically, proves that an item the
 * quantity run WITHHELD (replay conflict / unusable unit evidence) is still
 * reported in the basket's shopping evidence as demanded-but-unsourced, rather
 * than silently disappearing into a "complete" basket.
 *
 * SYNTHETIC mode only. No Airtable connection, no writes, no dispatch.
 */
import { describe, expect, it } from "vitest";

import { runSourceToBasketSlice } from "./harness";
import { eventRow, sliceNow, sliceProvenance, sliceScope } from "./fixtures";
import {
  createAirtableProductionPort,
  createFakeAirtableRowSource,
} from "../production-adapter/airtable-port";
import type { AirtableRow } from "../production-adapter/airtable-port";
import type { DemandTarget } from "../quantity-adapter/types";
import type { CatalogueEntry } from "../procurement/types";

/** Planning-supplied demand targets — never inferred from events/INVENTORY. */
const targets: DemandTarget[] = [
  { itemKey: "salmon-fillet", targetQuantity: 780, unit: "g", packSize: 260, packUnit: "g" },
  { itemKey: "rice-basmati", targetQuantity: 2000, unit: "g", packSize: 1000, packUnit: "g" },
];

const catalogue: CatalogueEntry[] = [
  { itemKey: "salmon-fillet", sku: "SKU-SALMON-260", productName: "Salmon Fillets 260g", retailer: "synthetic-grocer", packSize: 260, packUnit: "g", packPrice: 4.5 },
  { itemKey: "rice-basmati", sku: "SKU-RICE-1000", productName: "Basmati Rice 1kg", retailer: "synthetic-grocer", packSize: 1000, packUnit: "g", packPrice: 2.8 },
];

/** 780g salmon received, then the whole 780g consumed. Rice untouched at 500g. */
const rows: AirtableRow[] = [
  eventRow("recSALMON-IN", {
    "Event ID": "SYN-SALMON-1",
    "Event type": "Receipt",
    "Occurred at": "2026-08-01T06:00:00.000Z",
    Item: "salmon-fillet",
    "Quantity delta": 780,
    Unit: "g",
  }),
  eventRow("recSALMON-OUT", {
    "Event ID": "SYN-SALMON-2",
    "Event type": "Consumption",
    "Occurred at": "2026-08-04T18:00:00.000Z",
    Item: "salmon-fillet",
    "Quantity delta": 780,
    Unit: "g",
  }),
  eventRow("recRICE-IN", {
    "Event ID": "SYN-RICE-1",
    "Event type": "Receipt",
    "Occurred at": "2026-08-01T06:00:00.000Z",
    Item: "rice-basmati",
    "Quantity delta": 500,
    Unit: "g",
  }),
];

function port(source: AirtableRow[]) {
  return createAirtableProductionPort({
    source: createFakeAirtableRowSource({
      eventRows: source,
      baseLabel: "synthetic-salmon-slice",
      provenance: sliceProvenance,
    }),
    mode: "SYNTHETIC",
    portId: "fake-airtable:synthetic-salmon-slice",
  });
}

const run = (
  source: AirtableRow[] = rows,
  blockedItemPolicy: "REFUSE_RUN" | "ISOLATE_ITEMS" = "REFUSE_RUN",
) =>
  runSourceToBasketSlice({
    port: port(source),
    scope: sliceScope,
    targets,
    catalogue,
    now: sliceNow,
    blockedItemPolicy,
  });

/** Reused Event ID with a changed payload. */
const conflictingSalmon = eventRow("recSALMON-OUT-conflict", {
  "Event ID": "SYN-SALMON-2",
  "Event type": "Consumption",
  "Occurred at": "2026-08-04T18:00:00.000Z",
  Item: "salmon-fillet",
  "Quantity delta": 300,
  Unit: "g",
});

describe("salmon 780g burn-down through replay → quantity → procurement", () => {
  it("(1) 780g in, 780g out replays to 0g on hand and carries full provenance", async () => {
    const slice = await run();
    expect(slice.loaded.ok).toBe(true);
    expect(slice.loaded.writable).toBe(false);
    expect(slice.snapshot!.reconciliationStatus).toBe("CLEAN");
    expect(slice.snapshot!.items.find((i) => i.itemKey === "salmon-fillet")!.quantity).toBe(0);

    const salmon = slice.plan.requirements.find((r) => r.itemKey === "salmon-fillet")!;
    expect(salmon.onHandQuantity).toBe(0);
    expect(salmon.requiredQuantity).toBe(780);
    expect(salmon.sourceEventIds).toEqual(["SYN-SALMON-1", "SYN-SALMON-2"]);

    // Provenance required on every QUANTITY REQUIREMENTS handoff.
    expect(slice.plan.snapshotId).toBe(slice.snapshot!.snapshotId);
    expect(slice.plan.replayId).toBe(slice.snapshot!.replayId);
    expect(slice.plan.replayTimestamp).toBe(slice.snapshot!.replayTimestamp);
    expect(slice.plan.reconciliationStatus).toBe("CLEAN");

    // Existing procurement aggregation, unchanged: 780g over 260g packs = 3.
    const line = slice.basket.lines.find((l) => l.itemKey === "salmon-fillet")!;
    expect(line.packCount).toBe(3);
    expect(line.orderedQuantity).toBe(780);
    expect(line.sourceEventIds).toEqual(["SYN-SALMON-1", "SYN-SALMON-2"]);
    expect(slice.basket.dispatched).toBe(false);
    expect(slice.basket.requiresHumanApproval).toBe(true);
  });

  it("(2) an identical duplicate event is idempotent end-to-end", async () => {
    const base = await run();
    const twice = await run([...rows, { ...rows[1]!, id: "recSALMON-OUT-redelivered" }]);
    expect(twice.snapshot!.snapshotId).toBe(base.snapshot!.snapshotId);
    expect(twice.plan.planId).toBe(base.plan.planId);
    expect(twice.basket.basketId).toBe(base.basket.basketId);
    expect(
      twice.plan.requirements.find((r) => r.itemKey === "salmon-fillet")!.onHandQuantity,
    ).toBe(0);
  });

  it("(3) the same Event ID with a changed payload is conflict-blocked, no static fallback", async () => {
    const slice = await run([...rows, conflictingSalmon]);
    expect(slice.loaded.quarantinedItemKeys).toEqual(["salmon-fillet"]);
    expect(slice.plan.executed).toBe(false);
    expect(slice.plan.requirements).toEqual([]);
    expect(slice.basket.lines).toEqual([]);
    expect(slice.basket.complete).toBe(false);
    expect(slice.basket.readyForApproval).toBe(false);
    expect(slice.dispatched).toBe(false);
  });

  it("(4) Test records cannot contaminate the Production replay", async () => {
    const clean = await run();
    const contaminated = await run([
      ...rows,
      eventRow("recSALMON-TEST", {
        "Event ID": "SYN-SALMON-2", // reuses a Production Event ID with a new payload
        "Event type": "Consumption",
        "Occurred at": "2026-08-04T18:00:00.000Z",
        Item: "salmon-fillet",
        "Quantity delta": 99999,
        Unit: "g",
        "Record class": "Test",
      }),
    ]);
    expect(contaminated.plan.requirements).toEqual(clean.plan.requirements);
    expect(contaminated.sourceEventIds).toEqual(clean.sourceEventIds);
    expect(contaminated.loaded.quarantinedItemKeys).toEqual([]);
  });

  it("(5) a conflicted item blocks only itself, and stays visible as unsourced shopping evidence", async () => {
    const slice = await run([...rows, conflictingSalmon], "ISOLATE_ITEMS");

    // Unrelated household demand keeps planning.
    expect(slice.plan.requirements.map((r) => r.itemKey)).toEqual(["rice-basmati"]);
    expect(slice.plan.rejections.map((r) => r.code)).toContain("ITEM_ISOLATED");
    expect(slice.basket.lines.map((l) => l.itemKey)).toEqual(["rice-basmati"]);

    // REGRESSION: the withheld item must not vanish from the basket evidence.
    expect(slice.basket.coverage.demandItemKeys).toEqual(["rice-basmati", "salmon-fillet"]);
    expect(slice.basket.coverage.unsourcedItemKeys).toEqual(["salmon-fillet"]);
    expect(slice.basket.coverage.sourcedItemKeys).toEqual(["rice-basmati"]);
    expect(slice.basket.coverage.complete).toBe(false);
    expect(slice.basket.complete).toBe(false);
    expect(slice.basket.readyForApproval).toBe(false);
    expect(slice.basket.readyForReview).toBe(true);
    expect(
      slice.basket.exceptions.filter(
        (e) => e.code === "UPSTREAM_ITEM_WITHHELD" && e.itemKey === "salmon-fillet",
      ),
    ).toHaveLength(1);
    expect(slice.basket.dispatched).toBe(false);
  });
});
