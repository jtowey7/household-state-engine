import type { DispatchRecord, DispatchReceiptStore } from "./dispatch-adapter";

export function serializeDispatchReceiptStore(store: Map<string, DispatchRecord>): string {
  return JSON.stringify([...store.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function deserializeDispatchReceiptStore(serialized: string): Map<string, DispatchRecord> {
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new Error("Invalid dispatch receipt store: expected array");

  const store = new Map<string, DispatchRecord>();
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("Invalid dispatch receipt store: malformed entry");
    }
    const record = entry[1] as Partial<DispatchRecord> | null;
    if (
      !record ||
      typeof record.basketId !== "string" ||
      !Number.isSafeInteger(record.basketVersion) ||
      typeof record.basketFingerprint !== "string" ||
      typeof record.retailer !== "string" ||
      !record.receipt ||
      record.receipt.dispatchId !== entry[0] ||
      typeof record.receipt.retailer !== "string" ||
      typeof record.receipt.externalOrderId !== "string" ||
      typeof record.receipt.acceptedAt !== "string" ||
      record.receipt.status !== "ACCEPTED"
    ) {
      throw new Error("Invalid dispatch receipt store: malformed record");
    }
    store.set(entry[0], record as DispatchRecord);
  }
  return store;
}
