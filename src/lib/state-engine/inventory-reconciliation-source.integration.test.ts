import { describe, expect, it } from "vitest";
import {
  auditReconciledInventoryBaselineFromSource,
  buildReconciledInventoryBaselineFromSource,
  type InventoryReconciliationRow,
} from "./inventory-reconciliation-source";
import type { InventoryBaselineRow } from "./inventory-baseline";

const inventoryRows: InventoryBaselineRow[] = [
  {
    recordId: "rec-qualified",
    item: "Rice",
    quantity: 80,
    unit: "g",
    notes: "Partial supply.",
  },
  {
    recordId: "rec-qualified-2",
    item: "Custard",
    quantity: 1,
    unit: "container",
    notes: "Partial supply.",
  },
  {
    recordId: "rec-exact",
    item: "Milk",
    quantity: 2,
    unit: "pints",
    notes: "",
  },
];

const durableRows: InventoryReconciliationRow[] = [
  {
    id: "airtable-stale",
    fields: {
      Reconciliation: "James confirmation — stale exact row",
      "Inventory record ID": "rec-exact",
      Disposition: "CONFIRM_RECORDED_QUANTITY",
      Reason: "Previously confirmed.",
      Evidence: "Historical explicit confirmation.",
    },
  },
  {
    id: "airtable-b",
    fields: {
      Reconciliation: "James confirmation — custard",
      "Inventory record ID": "rec-qualified-2",
      Disposition: "CONFIRM_RECORDED_QUANTITY",
      Reason: "James explicitly confirmed the recorded quantity.",
      Evidence: "User confirmation A.",
    },
  },
  {
    id: "airtable-a",
    fields: {
      Reconciliation: "James confirmation — rice",
      "Inventory record ID": "rec-qualified",
      Disposition: "CONFIRM_RECORDED_QUANTITY",
      Reason: "James explicitly confirmed the recorded quantity.",
      Evidence: "User confirmation A.",
    },
  },
];

describe("fresh-session reconciliation -> baseline", () => {
  it("consumes durable decisions and clears only the explicitly reconciled current exceptions", async () => {
    const baseline = await buildReconciledInventoryBaselineFromSource(
      inventoryRows,
      "2026-08-14T21:00:00Z",
      { listRows: async () => durableRows },
    );

    expect(baseline.unresolvedExceptions).toEqual([]);
    expect(baseline.reconciliations).toHaveLength(2);
    expect(baseline.reconciliations.map((decision) => decision.recordId)).toEqual([
      "rec-qualified-2",
      "rec-qualified",
    ]);
    expect(baseline.events.find((event) => event.itemKey === "Rice")?.payload.evidencePrecision).toBe("EXACT");
    expect(baseline.events.find((event) => event.itemKey === "Custard")?.payload.evidencePrecision).toBe("EXACT");
    expect(baseline.events.find((event) => event.itemKey === "Milk")?.payload.evidencePrecision).toBe("EXACT");
  });

  it("reports the fresh-session readiness gate as zero exceptions", async () => {
    const audit = await auditReconciledInventoryBaselineFromSource(
      inventoryRows,
      "2026-08-14T21:00:00Z",
      { listRows: async () => durableRows },
    );

    expect(audit.reconciliationDecisionCount).toBe(2);
    expect(audit.exceptionCount).toBe(0);
    expect(audit.reconciledReady).toBe(true);
    expect(audit.readyForAuthority).toBe(true);
  });

  it("does not let an incomplete decision set masquerade as ready", async () => {
    const audit = await auditReconciledInventoryBaselineFromSource(
      inventoryRows,
      "2026-08-14T21:00:00Z",
      {
        listRows: async () => [durableRows[0]!],
      },
    );

    expect(audit.exceptionCount).toBe(2);
    expect(audit.reconciledReady).toBe(false);
    expect(audit.readyForAuthority).toBe(false);
  });
});
