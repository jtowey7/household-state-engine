import { describe, expect, it } from "vitest";
import {
  consumePersistedInventoryReconciliations,
  persistInventoryReconciliation,
  type InventoryReconciliationStore,
  type PersistedInventoryReconciliation,
} from "./inventory-reconciliation-persistence";

const BASELINE = "2026-08-14T20:00:00.000Z";

class MemoryStore implements InventoryReconciliationStore {
  private readonly rows = new Map<string, PersistedInventoryReconciliation>();

  async findByKey(key: string): Promise<PersistedInventoryReconciliation | null> {
    return this.rows.get(key) ?? null;
  }

  async append(record: PersistedInventoryReconciliation): Promise<void> {
    if (this.rows.has(record.reconciliationKey)) throw new Error("duplicate append");
    this.rows.set(record.reconciliationKey, record);
  }

  async list(): Promise<PersistedInventoryReconciliation[]> {
    return [...this.rows.values()];
  }
}

describe("inventory reconciliation persistence boundary", () => {
  it("appends an explicit decision and makes a repeated submission a no-op", async () => {
    const store = new MemoryStore();
    const decision = {
      recordId: "rec-ambiguous",
      disposition: "CONFIRM_RECORDED_QUANTITY" as const,
      reason: "Human confirmed the recorded quantity is the intended stock state.",
      evidence: "Explicit household confirmation on 2026-08-14.",
    };

    const first = await persistInventoryReconciliation(decision, store);
    const second = await persistInventoryReconciliation(decision, store);

    expect(first.outcome).toBe("APPENDED");
    expect(second.outcome).toBe("DUPLICATE_NOOP");
    expect(await store.list()).toHaveLength(1);
  });

  it("refuses a conflicting replay instead of overwriting the human decision", async () => {
    const store = new MemoryStore();
    const original = {
      recordId: "rec-ambiguous",
      disposition: "CONFIRM_RECORDED_QUANTITY" as const,
      reason: "Confirmed recorded quantity.",
      evidence: "Explicit household confirmation.",
    };
    await persistInventoryReconciliation(original, store);

    const conflict = await persistInventoryReconciliation(
      {
        ...original,
        disposition: "QUARANTINED_NON_STOCK",
        reason: "Later conflicting instruction.",
      },
      store,
    );

    expect(conflict.outcome).toBe("CONFLICT");
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0]?.disposition).toBe("CONFIRM_RECORDED_QUANTITY");
  });

  it("fresh-session consumption reconstructs the reconciled baseline from durable decisions", async () => {
    const store = new MemoryStore();
    await persistInventoryReconciliation(
      {
        recordId: "rec-a",
        disposition: "CONFIRM_RECORDED_QUANTITY",
        reason: "Human confirmed the recorded quantity.",
        evidence: "Explicit household confirmation.",
      },
      store,
    );
    await persistInventoryReconciliation(
      {
        recordId: "rec-b",
        disposition: "QUARANTINED_NON_STOCK",
        reason: "Human confirmed this is not current stock.",
        evidence: "Explicit household reconciliation.",
      },
      store,
    );

    // New consumer object: no decision state is carried in memory from the
    // persistence calls above; only the store is the durable source.
    const freshSession = new MemoryStore();
    for (const row of await store.list()) await freshSession.append(row);

    const baseline = await consumePersistedInventoryReconciliations(
      [
        { recordId: "rec-a", item: "Pasta", quantity: 250, unit: "g", notes: "partial" },
        { recordId: "rec-b", item: "Unknown jar", quantity: 0, unit: "jar", notes: "unknown" },
      ],
      BASELINE,
      freshSession,
    );

    expect(baseline.reconciliations.map((d) => d.recordId)).toEqual(["rec-a", "rec-b"]);
    expect(baseline.unresolvedExceptions).toEqual([]);
    expect(baseline.events).toHaveLength(1);
    expect(baseline.events[0]?.itemKey).toBe("Pasta");
  });

  it("does not infer a decision for an exception absent from the durable store", async () => {
    const store = new MemoryStore();
    const baseline = await consumePersistedInventoryReconciliations(
      [{ recordId: "rec-missing", item: "Rice", quantity: null, unit: "pack", notes: "partial" }],
      BASELINE,
      store,
    );

    expect(baseline.reconciliations).toEqual([]);
    expect(baseline.unresolvedExceptions).toEqual([
      expect.objectContaining({ recordId: "rec-missing", code: "MISSING_QUANTITY" }),
    ]);
  });
});
