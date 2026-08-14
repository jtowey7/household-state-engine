import { describe, expect, it } from "vitest";
import { hashOf } from "./hash";
import {
  AirtableInventoryReconciliationStore,
  type AirtableReconciliationPort,
} from "./airtable-inventory-reconciliation-store";
import { reconciliationKeyFor } from "./inventory-reconciliation-persistence";

class FakePort implements AirtableReconciliationPort {
  rows: Array<{ id: string; fields: Record<string, unknown> }> = [];
  created: Array<Record<string, unknown>> = [];

  async listReconciliations() {
    return this.rows;
  }

  async createReconciliation(fields: Record<string, unknown>) {
    this.created.push(fields);
  }
}

describe("Airtable inventory reconciliation store", () => {
  it("maps the real field contract and derives the same payload identity", async () => {
    const port = new FakePort();
    const recordId = "rec-1";
    const decision = {
      recordId,
      disposition: "CONFIRM_RECORDED_QUANTITY" as const,
      reason: "Human confirmed the recorded quantity.",
      evidence: "Explicit household confirmation.",
    };
    port.rows = [
      {
        id: "rec-airtable-1",
        fields: {
          Reconciliation: reconciliationKeyFor(recordId),
          "Inventory record ID": recordId,
          Disposition: decision.disposition,
          Reason: decision.reason,
          Evidence: decision.evidence,
          Source: "FoodOS reconciliation persistence",
          "Recorded at": "2026-08-14T21:00:00Z",
        },
      },
    ];

    const store = new AirtableInventoryReconciliationStore(port);
    const found = await store.findByKey(reconciliationKeyFor(recordId));

    expect(found).toMatchObject({
      ...decision,
      reconciliationKey: reconciliationKeyFor(recordId),
      payloadHash: hashOf(decision),
    });
  });

  it("writes only the real Airtable reconciliation fields", async () => {
    const port = new FakePort();
    const store = new AirtableInventoryReconciliationStore(port);
    const record = {
      recordId: "rec-2",
      disposition: "DISCARDED" as const,
      reason: "Human confirmed disposal.",
      evidence: "Explicit household reconciliation.",
      reconciliationKey: reconciliationKeyFor("rec-2"),
      payloadHash: hashOf({
        recordId: "rec-2",
        disposition: "DISCARDED",
        reason: "Human confirmed disposal.",
        evidence: "Explicit household reconciliation.",
      }),
    };

    await store.append(record);

    expect(port.created).toHaveLength(1);
    expect(port.created[0]).toEqual({
      Reconciliation: "INVENTORY_RECON:rec-2",
      "Inventory record ID": "rec-2",
      Disposition: "DISCARDED",
      Reason: "Human confirmed disposal.",
      Evidence: "Explicit household reconciliation.",
      Source: "FoodOS reconciliation persistence",
      "Recorded at": expect.any(String),
    });
  });

  it("refuses ambiguous duplicate durable keys", async () => {
    const port = new FakePort();
    const key = reconciliationKeyFor("rec-3");
    port.rows = [
      {
        id: "a",
        fields: {
          Reconciliation: key,
          "Inventory record ID": "rec-3",
          Disposition: "DISCARDED",
          Reason: "A",
          Evidence: "E",
        },
      },
      {
        id: "b",
        fields: {
          Reconciliation: key,
          "Inventory record ID": "rec-3",
          Disposition: "DISCARDED",
          Reason: "B",
          Evidence: "E",
        },
      },
    ];

    await expect(new AirtableInventoryReconciliationStore(port).findByKey(key)).rejects.toThrow(
      "Multiple durable reconciliation records",
    );
  });
});
