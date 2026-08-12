import { describe, expect, it } from "vitest";

import { loadProductionState, createMemoryProductionPort, productionPortContract } from ".";
import type { SourceScope } from ".";
import type { HouseholdEvent } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";

const scope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "synthetic-contract",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

const events: HouseholdEvent[] = [
  {
    eventId: "OPEN-A",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 1000, unit: "g" },
  },
  {
    eventId: "OPEN-B",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "milk-whole",
    occurredAt: "2026-08-01T06:00:00.000Z",
    payload: { quantity: 4, unit: "L" },
  },
];

const targets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L" },
];

const port = () => createMemoryProductionPort({ openingEvents: events, targets });

describe("production-state adapter (read-only)", () => {
  it("satisfies the port contract", async () => {
    const result = await productionPortContract(port(), scope);
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("exposes no write path and marks the load read-only", async () => {
    const p = port();
    expect("write" in p).toBe(false);
    const load = await loadProductionState(p, scope);
    expect(load.writable).toBe(false);
    expect(load.ok).toBe(true);
  });

  it("refuses a production scope served by a synthetic port", async () => {
    const load = await loadProductionState(port(), { ...scope, mode: "PRODUCTION_READ_ONLY" });
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("MODE_MISMATCH");
    expect(load.openingEvents).toEqual([]);
  });

  it("refuses synthetic provenance offered as production state", async () => {
    const lying = createMemoryProductionPort({
      mode: "PRODUCTION_READ_ONLY",
      provenance: "synthetic fixture",
      openingEvents: events,
      targets,
    });
    const load = await loadProductionState(lying, { ...scope, mode: "PRODUCTION_READ_ONLY" });
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("PROVENANCE_CONTAMINATION");
  });

  it("refuses production provenance smuggled into a synthetic run", async () => {
    const load = await loadProductionState(
      createMemoryProductionPort({ provenance: "airtable live household", openingEvents: events, targets }),
      scope,
    );
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("PROVENANCE_CONTAMINATION");
  });

  it("quarantines a reused Event ID with a different payload without failing the run", async () => {
    const conflicted: HouseholdEvent[] = [
      ...events,
      { ...events[0]!, payload: { quantity: 9999, unit: "g" } },
    ];
    const load = await loadProductionState(
      createMemoryProductionPort({ openingEvents: conflicted, targets }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.quarantinedItemKeys).toEqual(["oats-rolled"]);
    expect(load.openingEvents.map((e) => e.itemKey)).toEqual(["milk-whole"]);
    expect(load.rejections.map((r) => r.code)).toContain("DUPLICATE_EVENT_ID");
  });

  it("drops identical duplicate deliveries idempotently", async () => {
    const load = await loadProductionState(
      createMemoryProductionPort({ openingEvents: [...events, events[0]!], targets }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.quarantinedItemKeys).toEqual([]);
    expect(load.openingEvents).toHaveLength(2);
  });

  it("quarantines malformed rows only, leaving unrelated items planning", async () => {
    const load = await loadProductionState(
      createMemoryProductionPort({
        openingEvents: [...events, { ...events[0]!, eventId: "BAD", occurredAt: "" }],
        targets: [...targets, { itemKey: "rice-basmati", targetQuantity: 0, unit: "g" }],
      }),
      scope,
    );
    expect(load.ok).toBe(true);
    expect(load.quarantinedItemKeys).toEqual(["oats-rolled", "rice-basmati"]);
    expect(load.targets.map((t) => t.itemKey)).toEqual(["milk-whole"]);
  });

  it("reports an unavailable source as a fatal rejection rather than throwing", async () => {
    const load = await loadProductionState(
      createMemoryProductionPort({ openingEvents: events, targets, failWith: "connector offline" }),
      scope,
    );
    expect(load.ok).toBe(false);
    expect(load.rejections[0]?.code).toBe("SOURCE_UNAVAILABLE");
    expect(load.rejections[0]?.fatal).toBe(true);
  });

  it("is deterministic across identical reads", async () => {
    const a = await loadProductionState(port(), scope);
    const b = await loadProductionState(port(), scope);
    expect(a.sourceId).toBe(b.sourceId);
  });
});
