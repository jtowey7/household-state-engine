import { hashOf } from "./hash";
import type { HouseholdEvent } from "./types";

/**
 * Immutable current-state boundary between the legacy INVENTORY table and the
 * append-only HOUSEHOLD EVENTS model.
 *
 * This does NOT reconstruct history. Each eligible inventory row becomes one
 * ITEM_STOCK_SET event occurring exactly at the declared baseline timestamp.
 * Source record ID and snapshot provenance are carried in the event note.
 */
export interface InventoryBaselineRow {
  recordId: string;
  item: string;
  quantity: number | null | undefined;
  unit?: string | null;
  status?: string | null;
}

export interface BaselineException {
  recordId: string;
  code: "MISSING_ITEM" | "MISSING_QUANTITY" | "INVALID_QUANTITY" | "OUT_OF_STOCK";
  detail: string;
}

export interface InventoryBaseline {
  baselineTimestamp: string;
  source: "INVENTORY_SNAPSHOT";
  events: HouseholdEvent[];
  exceptions: BaselineException[];
  sourceRecordIds: string[];
  baselineId: string;
}

function assertBaselineTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid baseline timestamp: ${value}`);
  }
}

/**
 * Converts a fixed INVENTORY capture into an explicit Production baseline.
 * No Airtable access or writes occur here.
 */
export function buildInventoryBaseline(
  rows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
): InventoryBaseline {
  assertBaselineTimestamp(baselineTimestamp);

  const events: HouseholdEvent[] = [];
  const exceptions: BaselineException[] = [];
  const sourceRecordIds: string[] = [];

  for (const row of rows) {
    const recordId = row.recordId.trim();
    const itemKey = row.item.trim();
    sourceRecordIds.push(recordId);

    if (!recordId) {
      exceptions.push({
        recordId: row.recordId,
        code: "MISSING_ITEM",
        detail: "Inventory record has no stable source record ID; refusing to create a baseline event.",
      });
      continue;
    }

    if (!itemKey) {
      exceptions.push({
        recordId,
        code: "MISSING_ITEM",
        detail: "Inventory item is blank; refusing to create a baseline event.",
      });
      continue;
    }

    if ((row.status ?? "").trim().toLowerCase() === "out") {
      exceptions.push({
        recordId,
        code: "OUT_OF_STOCK",
        detail: "Status=Out is excluded from the current-stock baseline.",
      });
      continue;
    }

    if (row.quantity === null || row.quantity === undefined) {
      exceptions.push({
        recordId,
        code: "MISSING_QUANTITY",
        detail: "Inventory quantity is blank; row requires explicit reconciliation before baseline inclusion.",
      });
      continue;
    }

    if (!Number.isFinite(row.quantity) || row.quantity < 0) {
      exceptions.push({
        recordId,
        code: "INVALID_QUANTITY",
        detail: `Inventory quantity ${String(row.quantity)} is invalid for a stock baseline.`,
      });
      continue;
    }

    const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : undefined;
    const eventId = `BASELINE:${baselineTimestamp}:${hashOf(recordId)}`;
    events.push({
      eventId,
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey,
      occurredAt: baselineTimestamp,
      payload: {
        quantity: row.quantity,
        ...(unit ? { unit } : {}),
        note: `source=INVENTORY_SNAPSHOT;sourceRecordId=${recordId};baselineTimestamp=${baselineTimestamp}`,
      },
    });
  }

  const baselineId = hashOf({
    baselineTimestamp,
    source: "INVENTORY_SNAPSHOT",
    sourceRecordIds: [...sourceRecordIds].sort(),
    events: events.map((event) => ({
      eventId: event.eventId,
      itemKey: event.itemKey,
      payload: event.payload,
    })),
    exceptions,
  });

  return {
    baselineTimestamp,
    source: "INVENTORY_SNAPSHOT",
    events,
    exceptions,
    sourceRecordIds,
    baselineId,
  };
}
