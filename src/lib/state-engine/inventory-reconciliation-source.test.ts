import { describe, expect, it } from "vitest";
import {
  mapInventoryReconciliationRow,
  readInventoryBaselineReconciliations,
} from "./inventory-reconciliation-source";

describe("inventory reconciliation source", () => {
  it("maps the canonical Airtable fields without changing the inventory quantity", () => {
    const decision = mapInventoryReconciliationRow({
      id: "rec1",
      fields: {
        Reconciliation: "James confirmation — rice",
        "Inventory record ID": "recInventory1",
        Disposition: "CONFIRM_RECORDED_QUANTITY",
        Reason: "James explicitly confirmed the recorded quantity.",
        Evidence: "User confirmation A.",
        Source: "James — explicit reconciliation confirmation",
        "Recorded at": "2026-08-14T20:00:00+01:00",
      },
    });

    expect(decision).toEqual({
      recordId: "recInventory1",
      disposition: "CONFIRM_RECORDED_QUANTITY",
      reason: "James explicitly confirmed the recorded quantity.",
      evidence: "User confirmation A.",
    });
  });

  it("reconstructs a deterministic ordered decision set from a fresh source read", async () => {
    const decisions = await readInventoryBaselineReconciliations({
      async listRows() {
        return [
          {
            id: "rec2",
            fields: {
              "Inventory record ID": "recB",
              Disposition: "CONFIRM_RECORDED_QUANTITY",
              Reason: "confirmed",
              Evidence: "James A",
            },
          },
          {
            id: "rec1",
            fields: {
              "Inventory record ID": "recA",
              Disposition: "QUARANTINED_NON_STOCK",
              Reason: "not stock",
              Evidence: "James decision",
            },
          },
        ];
      },
    });

    expect(decisions.map((d) => d.recordId)).toEqual(["recA", "recB"]);
  });

  it("blocks duplicate decisions for one inventory record", async () => {
    await expect(
      readInventoryBaselineReconciliations({
        async listRows() {
          return [
            {
              id: "rec1",
              fields: {
                "Inventory record ID": "recA",
                Disposition: "CONFIRM_RECORDED_QUANTITY",
                Reason: "confirmed",
                Evidence: "James A",
              },
            },
            {
              id: "rec2",
              fields: {
                "Inventory record ID": "recA",
                Disposition: "CONFIRM_RECORDED_QUANTITY",
                Reason: "confirmed again",
                Evidence: "James A",
              },
            },
          ];
        },
      }),
    ).rejects.toThrow("Duplicate reconciliation for inventory record: recA");
  });

  it("rejects invalid or incomplete control-plane rows", () => {
    expect(() =>
      mapInventoryReconciliationRow({
        id: "rec1",
        fields: {
          "Inventory record ID": "recA",
          Disposition: "CONFIRM_RECORDED_QUANTITY",
          Reason: "confirmed",
        },
      }),
    ).toThrow("has no evidence");
  });
});
