/** Local in-memory materialisation port. Test/console use only — no network. */

import type { InventoryRow, MaterialisationLine, MaterialisationPort } from "./types";

export interface MemoryMaterialisationPortOptions {
  inventory?: InventoryRow[];
  /** Event IDs currently not Applied; only these get flipped. */
  pendingEventIds?: string[];
  failOnInventoryItem?: string;
  failOnReplayStatusUpdate?: boolean;
}

export interface MemoryMaterialisationPort extends MaterialisationPort {
  rows: InventoryRow[];
  appliedEventIds: string[];
  writeCallCount: number;
}

export function createMemoryMaterialisationPort(
  options: MemoryMaterialisationPortOptions = {},
): MemoryMaterialisationPort {
  const rows: InventoryRow[] = (options.inventory ?? []).map((row) => ({ ...row }));
  const pending = new Set(options.pendingEventIds ?? []);
  const applied: string[] = [];
  let nextId = 1;

  const port: MemoryMaterialisationPort = {
    portId: "memory-materialisation-port",
    rows,
    appliedEventIds: applied,
    writeCallCount: 0,
    async listInventory() {
      return rows.map((row) => ({ ...row }));
    },
    async createInventoryRow(line: MaterialisationLine) {
      if (options.failOnInventoryItem === line.itemKey) throw new Error("simulated inventory failure");
      port.writeCallCount += 1;
      const recordId = `rec-memory-${nextId++}`;
      rows.push({ recordId, item: line.itemKey, quantity: line.quantity, unit: line.unit, status: "Materialised", notes: line.notes });
      return { recordId };
    },
    async updateInventoryRow(recordId: string, line: MaterialisationLine) {
      if (options.failOnInventoryItem === line.itemKey) throw new Error("simulated inventory failure");
      port.writeCallCount += 1;
      const row = rows.find((candidate) => candidate.recordId === recordId);
      if (!row) throw new Error(`Unknown INVENTORY record ${recordId}`);
      row.quantity = line.quantity;
      row.unit = line.unit;
      row.status = "Materialised";
      row.notes = line.notes;
    },
    async markEventsReplayed(eventIds: string[]) {
      if (options.failOnReplayStatusUpdate) throw new Error("simulated replay status failure");
      const updated: string[] = [];
      for (const eventId of eventIds) {
        if (!pending.has(eventId)) continue;
        pending.delete(eventId);
        applied.push(eventId);
        updated.push(eventId);
      }
      return { updatedEventIds: updated };
    },
  };

  return port;
}
