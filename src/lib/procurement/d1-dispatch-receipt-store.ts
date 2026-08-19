import type { DispatchRecord, DispatchReceiptStore } from "./dispatch-adapter";

type D1Result<T> = { results?: T[] };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
};

export type D1DatabaseLike = {
  prepare(sql: string): D1Statement;
};

type DispatchReceiptRow = {
  dispatch_id: string;
  basket_id: string;
  basket_version: number;
  basket_fingerprint: string;
  retailer: string;
  external_order_id: string;
  accepted_at: string;
  status: "ACCEPTED";
};

function rowToRecord(row: DispatchReceiptRow): DispatchRecord {
  if (
    !row ||
    typeof row.dispatch_id !== "string" ||
    typeof row.basket_id !== "string" ||
    !Number.isSafeInteger(row.basket_version) ||
    typeof row.basket_fingerprint !== "string" ||
    typeof row.retailer !== "string" ||
    typeof row.external_order_id !== "string" ||
    typeof row.accepted_at !== "string" ||
    row.status !== "ACCEPTED"
  ) {
    throw new Error("Invalid persisted dispatch receipt: malformed record");
  }

  return {
    basketId: row.basket_id,
    basketVersion: row.basket_version,
    basketFingerprint: row.basket_fingerprint,
    retailer: row.retailer,
    receipt: {
      dispatchId: row.dispatch_id,
      retailer: row.retailer,
      externalOrderId: row.external_order_id,
      acceptedAt: row.accepted_at,
      status: "ACCEPTED",
    },
  };
}

/**
 * TEST-only receipt store backed by the owned runtime D1 database.
 * Production household tables are never touched by this store.
 */
export function createD1DispatchReceiptStore(db: D1DatabaseLike): DispatchReceiptStore {
  return {
    async get(dispatchId) {
      const row = await db
        .prepare(
          `SELECT dispatch_id, basket_id, basket_version, basket_fingerprint, retailer,
                  external_order_id, accepted_at, status
             FROM runtime_dispatch_receipts
            WHERE dispatch_id = ?`,
        )
        .bind(dispatchId)
        .first<DispatchReceiptRow>();

      return row ? rowToRecord(row) : undefined;
    },

    async set(dispatchId, record) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO runtime_dispatch_receipts
             (dispatch_id, basket_id, basket_version, basket_fingerprint, retailer,
              external_order_id, accepted_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?)`,
        )
        .bind(
          dispatchId,
          record.basketId,
          record.basketVersion,
          record.basketFingerprint,
          record.retailer,
          record.receipt.externalOrderId,
          record.receipt.acceptedAt,
          Date.now(),
        )
        .run();
    },
  };
}
