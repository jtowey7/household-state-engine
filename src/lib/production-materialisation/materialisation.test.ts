import { describe, expect, it } from "vitest";

import { createMemoryProductionPort } from "../production-adapter/memory-port";
import type { SourceScope } from "../production-adapter/types";
import type { HouseholdEvent } from "../state-engine/types";
import { createMemoryMaterialisationPort } from "./memory-port";
import { runProductionMaterialisation } from "./run";
import type { MaterialisationApproval } from "./types";

const scope: SourceScope = {
  mode: "PRODUCTION_READ_ONLY",
  datasetId: "FoodOS Production HOUSEHOLD EVENTS",
  windowStart: "2026-09-01",
  windowEnd: "2026-09-12",
};

const REPLAY_CLOCK = "2026-09-12T10:00:00.000Z";

function events(): HouseholdEvent[] {
  return [
    {
      eventId: "EV-SALMON-1",
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: "salmon fillet",
      occurredAt: "2026-09-11T09:00:00.000Z",
      payload: { quantity: 780, unit: "g", evidencePrecision: "EXACT" },
    },
    {
      eventId: "EV-BUTTER-1",
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: "butter",
      occurredAt: "2026-09-11T09:05:00.000Z",
      payload: { quantity: 250, unit: "g", evidencePrecision: "EXACT" },
    },
  ];
}

function readPort(stream: HouseholdEvent[]) {
  return createMemoryProductionPort({
    portId: "test-production-port",
    mode: "PRODUCTION_READ_ONLY",
    claimedMode: "PRODUCTION_READ_ONLY",
    provenance: "airtable read-only GET test",
    openingEvents: stream,
  });
}

async function approvalFor(stream: HouseholdEvent[]): Promise<MaterialisationApproval> {
  const { replayEvents } = await import("../state-engine/engine");
  const snapshot = replayEvents(stream, { now: () => REPLAY_CLOCK });
  return {
    approvalId: "APR-FAMILY-ALPHA-1",
    approvedBy: "James Towey",
    approvedAt: "2026-09-12T09:59:00.000Z",
    expectedSnapshotId: snapshot.snapshotId,
    expectedReplayId: snapshot.replayId,
  };
}

describe("production inventory materialisation seam", () => {
  it("materialises replayed state into INVENTORY with provenance, then marks events Applied", async () => {
    const stream = events();
    const writePort = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"] });

    const result = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: await approvalFor(stream),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.execution.created).toBe(2);
    expect(writePort.rows.map((row) => [row.item, row.quantity, row.unit])).toEqual([
      ["butter", 250, "g"],
      ["salmon fillet", 780, "g"],
    ]);
    const salmon = writePort.rows.find((row) => row.item === "salmon fillet");
    expect(salmon?.notes).toContain(result.plan.snapshotId);
    expect(salmon?.notes).toContain("EV-SALMON-1");
    expect(writePort.appliedEventIds.sort()).toEqual(["EV-BUTTER-1", "EV-SALMON-1"]);
  });

  it("is exactly-once: an identical second run writes nothing new", async () => {
    const stream = events();
    const approval = await approvalFor(stream);
    const writePort = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"] });

    const first = await runProductionMaterialisation({ readPort: readPort(stream), writePort, scope, replayClock: REPLAY_CLOCK, approval });
    const writesAfterFirst = writePort.writeCallCount;
    const second = await runProductionMaterialisation({ readPort: readPort(stream), writePort, scope, replayClock: REPLAY_CLOCK, approval });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.plan.materialisationId).toBe(first.plan.materialisationId);
    expect(second.plan.alreadyMaterialised).toBe(true);
    expect(writePort.writeCallCount).toBe(writesAfterFirst);
    expect(writePort.rows).toHaveLength(2);
    expect(second.execution.replayStatusUpdatedEventIds).toEqual([]);
  });

  it("re-running after a failed replay-status update completes the flip without duplicating inventory", async () => {
    const stream = events();
    const approval = await approvalFor(stream);
    const failing = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"], failOnReplayStatusUpdate: true });

    const first = await runProductionMaterialisation({ readPort: readPort(stream), writePort: failing, scope, replayClock: REPLAY_CLOCK, approval });
    expect(first.ok).toBe(false);
    if (first.ok || first.stage !== "EXECUTE") throw new Error("expected execute failure");
    expect(first.execution.code).toBe("REPLAY_STATUS_UPDATE_FAILED");
    expect(failing.appliedEventIds).toEqual([]);

    const retry = createMemoryMaterialisationPort({ inventory: failing.rows, pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"] });
    const second = await runProductionMaterialisation({ readPort: readPort(stream), writePort: retry, scope, replayClock: REPLAY_CLOCK, approval });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(retry.rows).toHaveLength(2);
    expect(retry.writeCallCount).toBe(0);
    expect(retry.appliedEventIds.sort()).toEqual(["EV-BUTTER-1", "EV-SALMON-1"]);
  });

  it("never flips replay status when an INVENTORY write fails", async () => {
    const stream = events();
    const writePort = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"], failOnInventoryItem: "salmon fillet" });

    const result = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: await approvalFor(stream),
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.stage !== "EXECUTE") throw new Error("expected execute failure");
    expect(result.execution.code).toBe("INVENTORY_WRITE_FAILED");
    expect(result.execution.replayStatusUpdated).toBe(false);
    expect(writePort.appliedEventIds).toEqual([]);
  });

  it("fails closed on an unresolved conflict and writes nothing", async () => {
    const stream = [
      ...events(),
      {
        eventId: "EV-SALMON-1",
        recordClass: "Production" as const,
        eventType: "ITEM_STOCK_SET" as const,
        itemKey: "salmon fillet",
        occurredAt: "2026-09-11T09:00:00.000Z",
        payload: { quantity: 500, unit: "g", evidencePrecision: "EXACT" as const },
      },
    ];
    const writePort = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1"] });

    const result = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: {
        approvalId: "APR-1",
        approvedBy: "James Towey",
        approvedAt: "2026-09-12T09:59:00.000Z",
        expectedSnapshotId: "any",
        expectedReplayId: "any",
      },
    });

    expect(result.ok).toBe(false);
    expect(writePort.rows).toEqual([]);
    expect(writePort.appliedEventIds).toEqual([]);
  });

  it("refuses a run without a human approval bound to this exact snapshot", async () => {
    const stream = events();
    const writePort = createMemoryMaterialisationPort({ pendingEventIds: ["EV-SALMON-1"] });

    const automated = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: { ...(await approvalFor(stream)), approvedBy: "foodOS scheduler" },
    });
    expect(automated.ok).toBe(false);
    if (automated.ok || automated.stage !== "PLAN") throw new Error("expected plan refusal");
    expect(automated.code).toBe("AUTOMATED_APPROVAL_REJECTED");

    const stale = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: { ...(await approvalFor(stream)), expectedSnapshotId: "snapshot-from-yesterday" },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok || stale.stage !== "PLAN") throw new Error("expected plan refusal");
    expect(stale.code).toBe("APPROVAL_BINDING_MISMATCH");

    expect(writePort.rows).toEqual([]);
    expect(writePort.appliedEventIds).toEqual([]);
  });

  it("refuses to guess when INVENTORY holds two rows for the same item", async () => {
    const stream = events();
    const writePort = createMemoryMaterialisationPort({
      pendingEventIds: ["EV-SALMON-1"],
      inventory: [
        { recordId: "rec1", item: "Butter", quantity: 100, unit: "g" },
        { recordId: "rec2", item: "butter", quantity: 50, unit: "g" },
      ],
    });

    const result = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: await approvalFor(stream),
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.stage !== "PLAN") throw new Error("expected plan refusal");
    expect(result.code).toBe("AMBIGUOUS_INVENTORY_TARGET");
    expect(writePort.appliedEventIds).toEqual([]);
  });
});

describe("test-record isolation", () => {
  it("never materialises a Test record and never flips its replay status", async () => {
    const stream: HouseholdEvent[] = [
      ...events(),
      {
        eventId: "EV-TEST-1",
        recordClass: "Test",
        eventType: "ITEM_STOCK_SET",
        itemKey: "synthetic demo item",
        occurredAt: "2026-09-11T09:10:00.000Z",
        payload: { quantity: 999, unit: "g", evidencePrecision: "EXACT" },
      },
    ];
    const writePort = createMemoryMaterialisationPort({
      pendingEventIds: ["EV-SALMON-1", "EV-BUTTER-1", "EV-TEST-1"],
    });

    const result = await runProductionMaterialisation({
      readPort: readPort(stream),
      writePort,
      scope,
      replayClock: REPLAY_CLOCK,
      approval: await approvalFor(stream),
    });

    expect(result.ok).toBe(true);
    expect(writePort.rows.map((row) => row.item)).toEqual(["butter", "salmon fillet"]);
    expect(writePort.appliedEventIds).not.toContain("EV-TEST-1");
  });
});
