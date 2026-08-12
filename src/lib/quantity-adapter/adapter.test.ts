import { describe, expect, it } from "vitest";

import { replayEvents } from "../state-engine/engine";
import { baseFixture, conflictFixture } from "../state-engine/fixtures";
import type { HouseholdEvent, QuantityRequirementsHandoff } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "./adapter";
import { shadowConsolidationEvents, shadowTargets } from "./fixtures";
import { shadowRun } from "./shadow-run";

const fixedNow = { now: () => "1970-01-01T00:00:00.000Z" };

describe("Replay -> Quantity Requirements adapter", () => {
  it("clean replay produces deterministic quantity requirements", () => {
    const { plan } = shadowRun(
      [baseFixture[0]!] as HouseholdEvent[],
      shadowTargets.filter((t) => t.itemKey === "oats-rolled"),
      fixedNow,
    );
    expect(plan.executed).toBe(true);
    expect(plan.eligibleForProcurement).toBe(true);
    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]).toMatchObject({
      itemKey: "oats-rolled",
      onHandQuantity: 1200,
      targetQuantity: 2000,
      requiredQuantity: 800,
      unit: "g",
    });
  });

  it("preserves replay identity and per-item provenance", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, { targets: shadowTargets });
    expect(plan.replayId).toBe(snapshot.replayId);
    expect(plan.snapshotId).toBe(snapshot.snapshotId);
    expect(plan.replayTimestamp).toBe(snapshot.replayTimestamp);
    expect(plan.reconciliationStatus).toBe(snapshot.reconciliationStatus);
    const oats = plan.requirements.find((r) => r.itemKey === "oats-rolled");
    expect(oats?.sourceEventIds).toEqual(["EVT-1001"]);
    const milk = plan.requirements.find((r) => r.itemKey === "milk-whole");
    expect(milk?.sourceEventIds).toEqual(["EVT-1002"]);
  });

  it("blocked replay emits no requirements and refuses execution", () => {
    const { plan } = shadowRun(conflictFixture, shadowTargets, fixedNow);
    expect(plan.reconciliationStatus).toBe("BLOCKED");
    expect(plan.executed).toBe(false);
    expect(plan.eligibleForProcurement).toBe(false);
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections[0]?.code).toBe("RECONCILIATION_BLOCKED");
  });

  it("refuses uncertain reconciliation (blocked items present)", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const handoff: QuantityRequirementsHandoff = {
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: snapshot.replayTimestamp,
      reconciliationStatus: "EXCEPTIONS",
      readyForQuantityRun: true,
      items: [
        { itemKey: "oats-rolled", quantity: 100, unit: "g", sourceEventIds: ["EVT-1001"] },
      ],
      blockedItemKeys: ["milk-whole"],
    };
    const plan = adaptSnapshotToQuantityRun(handoff, { targets: shadowTargets });
    expect(plan.executed).toBe(false);
    expect(plan.rejections[0]?.code).toBe("RECONCILIATION_UNCERTAIN");
  });

  it("is deterministic across repeated runs", () => {
    const a = shadowRun(baseFixture, shadowTargets, fixedNow);
    const b = shadowRun(baseFixture, shadowTargets, fixedNow);
    expect(a.plan.planId).toBe(b.plan.planId);
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
  });

  it("rejects zero and negative requirement quantities", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const handoff = {
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: snapshot.replayTimestamp,
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "oats-rolled", quantity: 2000, unit: "g", sourceEventIds: ["EVT-1001"] },
        { itemKey: "milk-whole", quantity: -3, unit: "L", sourceEventIds: ["EVT-1002"] },
      ],
      blockedItemKeys: [],
    };
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: shadowTargets.filter(
        (t) => t.itemKey === "oats-rolled" || t.itemKey === "milk-whole",
      ),
    });
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections.map((r) => r.code)).toEqual([
      "NON_POSITIVE_QUANTITY",
      "NON_POSITIVE_QUANTITY",
    ]);
    expect(plan.eligibleForProcurement).toBe(false);
  });

  it("rejects unit mismatch against the demand target", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const handoff = {
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: snapshot.replayTimestamp,
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "oats-rolled", quantity: 1, unit: "kg", sourceEventIds: ["EVT-1001"] },
      ],
      blockedItemKeys: [],
    };
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: shadowTargets.filter((t) => t.itemKey === "oats-rolled"),
    });
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections[0]?.code).toBe("UNIT_MISMATCH");
  });

  it("consolidates duplicate requirement lines for the same item", () => {
    const { plan } = shadowRun(shadowConsolidationEvents, shadowTargets, fixedNow);
    const eggs = plan.requirements.filter((r) => r.itemKey === "eggs-large");
    expect(eggs).toHaveLength(1);
    expect(eggs[0]?.onHandQuantity).toBe(5);
    expect(eggs[0]?.requiredQuantity).toBe(7);
    expect(eggs[0]?.sourceEventIds).toEqual(["EVT-9001", "EVT-9002"]);
  });

  it("emits pack-rounding compatible output", () => {
    const { plan } = shadowRun(shadowConsolidationEvents, shadowTargets, fixedNow);
    const eggs = plan.requirements.find((r) => r.itemKey === "eggs-large")!;
    expect(eggs.packSize).toBe(6);
    expect(eggs.packCount).toBe(2); // ceil(7 / 6)
    expect(eggs.packRoundedQuantity).toBe(12);
    expect(eggs.packRoundedQuantity!).toBeGreaterThanOrEqual(eggs.requiredQuantity);

    const incompatible = adaptSnapshotToQuantityRun(
      {
        replayId: "r",
        snapshotId: "s",
        replayTimestamp: "1970-01-01T00:00:00.000Z",
        reconciliationStatus: "CLEAN",
        readyForQuantityRun: true,
        items: [{ itemKey: "oats-rolled", quantity: 0, unit: "g", sourceEventIds: ["E1"] }],
        blockedItemKeys: [],
      },
      {
        targets: [
          { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 1, packUnit: "kg" },
        ],
      },
    );
    expect(incompatible.rejections[0]?.code).toBe("PACK_ROUNDING_INCOMPATIBLE");
    expect(incompatible.requirements).toEqual([]);
  });

  it("shadow run never dispatches downstream", () => {
    const result = shadowRun(baseFixture, shadowTargets, fixedNow);
    expect(result.dispatched).toBe(false);
  });
});

describe("demand universe includes targets absent from the replayed snapshot", () => {
  const eggTargets = [
    ...shadowTargets,
    { itemKey: "eggs", targetQuantity: 12, unit: "count" as const },
  ];

  it("emits a full requirement for a target item with no replayed stock", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, { targets: eggTargets });
    const eggs = plan.requirements.find((r) => r.itemKey === "eggs");
    expect(eggs).toBeDefined();
    expect(eggs?.onHandQuantity).toBe(0);
    expect(eggs?.targetQuantity).toBe(12);
    expect(eggs?.requiredQuantity).toBe(12);
    expect(eggs?.unit).toBe("count");
    expect(eggs?.sourceEventIds).toEqual([]);
    expect(plan.eligibleForProcurement).toBe(true);
    expect(plan.executed).toBe(true);
  });

  it("keeps an absent-but-blocked target isolated rather than procuring it", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: eggTargets,
      isolatedItemKeys: ["eggs"],
      blockedItemPolicy: "ISOLATE_ITEMS",
    });
    expect(plan.requirements.some((r) => r.itemKey === "eggs")).toBe(false);
    expect(
      plan.rejections.some((r) => r.code === "ITEM_ISOLATED" && r.itemKey === "eggs"),
    ).toBe(true);
  });

  it("keeps planId deterministic across repeated runs with absent targets", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const a = adaptSnapshotToQuantityRun(snapshot, { targets: eggTargets });
    const b = adaptSnapshotToQuantityRun(snapshot, { targets: eggTargets });
    expect(a.planId).toBe(b.planId);
    expect(a.requirements).toEqual(b.requirements);
  });
});
