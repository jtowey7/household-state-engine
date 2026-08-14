import { hashOf } from "./hash";
import type { HouseholdEvent } from "./types";

/**
 * Immutable current-state boundary between the legacy INVENTORY table and the
 * append-only HOUSEHOLD EVENTS model.
 *
 * This does NOT reconstruct history. Each eligible logical item/unit group
 * becomes one ITEM_STOCK_SET event occurring exactly at the declared baseline
 * timestamp. Multiple inventory rows for the same item/unit are aggregated
 * deterministically, with every source record ID preserved in the event note.
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
  code:
    | "MISSING_ITEM"
    | "MISSING_QUANTITY"
    | "INVALID_QUANTITY"
    | "OUT_OF_STOCK"
    | "DUPLICATE_SOURCE_RECORD";
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

interface CandidateGroup {
  itemKey: string;
  unit?: string;
  quantity: number;
  sourceRecordIds: string[];
}

/**
 * Converts a fixed INVENTORY capture into an explicit Production baseline.
 * No Airtable access or writes occur here.
 *
 * Duplicate item/unit rows are a normal property of the legacy inventory
 * capture (for example, two partial pasta packets). They are summed only when
 * the item key AND unit match exactly. We never infer cross-unit conversion.
 * All contributing source record IDs remain in the event provenance note.
 *
 * A repeated source record ID is different: it indicates duplicate input rather
 * than two pieces of stock. It is quarantined so pagination/retry duplication
 * cannot silently inflate the baseline.
 */
export function buildInventoryBaseline(
  rows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
): InventoryBaseline {
  assertBaselineTimestamp(baselineTimestamp);

  const events: HouseholdEvent[] = [];
  const exceptions: BaselineException[] = [];
  const sourceRecordIds: string[] = [];
  const groups = new Map<string, CandidateGroup>();
  const seenRecordIds = new Set<string>();

  for (const row of rows) {
    const recordId = row.recordId.trim();
    const itemKey = row.item.trim();
    sourceRecordIds.push(recordId);

    if (!recordId || !itemKey) continue;
    if (seenRecordIds.has(recordId)) continue;
    seenRecordIds.add(recordId);
    if ((row.status ?? "").trim().toLowerCase() === "out") continue;
    if (row.quantity === null || row.quantity === undefined) continue;
    if (!Number.isFinite(row.quantity) || row.quantity < 0) continue;

    const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : undefined;
    const key = `${itemKey}\u0000${unit ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.sourceRecordIds.push(recordId);
    } else {
      groups.set(key, {
        itemKey,
        ...(unit ? { unit } : {}),
        quantity: row.quantity,
        sourceRecordIds: [recordId],
      });
    }
  }

  const validatedRecordIds = new Set<string>();
  for (const row of rows) {
    const recordId = row.recordId.trim();
    const itemKey = row.item.trim();

    if (!recordId) {
      exceptions.push({
        recordId: row.recordId,
        code: "MISSING_ITEM",
        detail: "Inventory record has no stable source record ID; refusing to create a baseline event.",
      });
      continue;
    }

    if (validatedRecordIds.has(recordId)) {
      exceptions.push({
        recordId,
        code: "DUPLICATE_SOURCE_RECORD",
        detail: "The same source record ID appeared more than once in the inventory snapshot; refusing to count it twice.",
      });
      continue;
    }
    validatedRecordIds.add(recordId);

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
  }

  for (const group of [...groups.values()].sort((a, b) =>
    `${a.itemKey}\u0000${a.unit ?? ""}`.localeCompare(`${b.itemKey}\u0000${b.unit ?? ""}`),
  )) {
    const sourceIds = [...group.sourceRecordIds].sort();
    const eventId = `BASELINE:${baselineTimestamp}:${hashOf(sourceIds)}`;
    events.push({
      eventId,
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: group.itemKey,
      occurredAt: baselineTimestamp,
      payload: {
        quantity: group.quantity,
        ...(group.unit ? { unit: group.unit } : {}),
        note:
          `source=INVENTORY_SNAPSHOT;sourceRecordIds=${sourceIds.join(",")};baselineTimestamp=${baselineTimestamp}`,
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
