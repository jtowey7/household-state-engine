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

  it("rejects non-finite and negative on-hand quantities", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const handoff = {
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: snapshot.replayTimestamp,
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "oats-rolled", quantity: -1, unit: "g", sourceEventIds: ["EVT-1001"] },
        { itemKey: "milk-whole", quantity: Number.NaN, unit: "L", sourceEventIds: ["EVT-1002"] },
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
    const snapshot = replayEvents(baseFixture, fixedNow);
    const handoff = {
      replayId: snapshot.replayId,
      snapshotId: snapshot.snapshotId,
      replayTimestamp: snapshot.replayTimestamp,
      reconciliationStatus: "CLEAN" as const,
      readyForQuantityRun: true,
      items: [
        { itemKey: "oats-rolled", quantity: 200, unit: "g", sourceEventIds: ["EVT-1001"] },
        { itemKey: "oats-rolled", quantity: 300, unit: "g", sourceEventIds: ["EVT-1003"] },
      ],
      blockedItemKeys: [],
    };
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: [{ itemKey: "oats-rolled", targetQuantity: 1000, unit: "g" }],
    });
    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]?.onHandQuantity).toBe(500);
    expect(plan.requirements[0]?.sourceEventIds).toEqual(["EVT-1001", "EVT-1003"]);
  });

  it("rejects duplicate demand targets instead of silently taking the last row", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [
        { itemKey: "oats-rolled", targetQuantity: 1000, unit: "g" },
        { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g" },
      ],
    });
    expect(plan.executed).toBe(false);
    expect(plan.rejections[0]?.code).toBe("DUPLICATE_DEMAND_TARGET");
  });

  it("emits pack-rounding compatible output", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" }],
    });
    const oats = plan.requirements.find((r) => r.itemKey === "oats-rolled");
    expect(oats?.packCount).toBe(2);
    expect(oats?.packRoundedQuantity).toBe(1000);
  });

  it("shadow run never dispatches downstream", () => {
    const { plan, dispatched } = shadowRun(baseFixture, shadowTargets, fixedNow);
    expect(plan.executed).toBe(true);
    expect(dispatched).toBe(false);
  });

  it("emits a full requirement for a target item with no replayed stock", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "eggs-large", targetQuantity: 12, unit: "each" }],
    });
    expect(plan.eligibleForProcurement).toBe(true);
    expect(plan.requirements[0]).toMatchObject({
      itemKey: "eggs-large",
      onHandQuantity: 0,
      requiredQuantity: 12,
      sourceEventIds: [],
    });
  });

  it("keeps an absent-but-blocked target isolated rather than procuring it", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const plan = adaptSnapshotToQuantityRun(snapshot, {
      targets: [{ itemKey: "eggs-large", targetQuantity: 12, unit: "each" }],
      blockedItemPolicy: "ISOLATE_ITEMS",
      isolatedItemKeys: ["eggs-large"],
    });
    expect(plan.requirements).toEqual([]);
    expect(plan.rejections.map((r) => r.code)).toContain("ITEM_ISOLATED");
    expect(plan.eligibleForProcurement).toBe(false);
  });

  it("keeps planId deterministic across repeated runs with absent targets", () => {
    const snapshot = replayEvents(baseFixture, fixedNow);
    const options = { targets: [{ itemKey: "eggs-large", targetQuantity: 12, unit: "each" }] };
    const a = adaptSnapshotToQuantityRun(snapshot, options);
    const b = adaptSnapshotToQuantityRun(snapshot, options);
    expect(a.planId).toBe(b.planId);
  });
});
