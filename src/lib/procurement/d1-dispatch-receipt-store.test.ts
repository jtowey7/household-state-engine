import { describe, expect, it } from "vitest";

import { createD1DispatchReceiptStore, type D1DatabaseLike } from "./d1-dispatch-receipt-store";
import type { DispatchRecord } from "./dispatch-adapter";

function createFakeD1() {
  const rows = new Map<string, Record<string, unknown>>();

  const db: D1DatabaseLike = {
    prepare(sql) {
      let values: unknown[] = [];
      const statement = {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return statement;
        },
        async first<T>() {
          const dispatchId = String(values[0]);
          return (rows.get(dispatchId) ?? null) as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          const dispatchId = String(values[0]);
          if (sql.includes("INSERT OR IGNORE") && !rows.has(dispatchId)) {
            rows.set(dispatchId, {
              dispatch_id: dispatchId,
              basket_id: String(values[1]),
              basket_version: Number(values[2]),
              basket_fingerprint: String(values[3]),
              retailer: String(values[4]),
              external_order_id: String(values[5]),
              accepted_at: String(values[6]),
              status: "ACCEPTED",
            });
          }
          return { success: true };
        },
      };
      return statement;
    },
  };

  return { db, rows };
}

const record: DispatchRecord = {
  basketId: "BASKET-1",
  basketVersion: 1,
  basketFingerprint: "FP-1",
  retailer: "synthetic-grocer",
  receipt: {
    dispatchId: "DISPATCH-1",
    retailer: "synthetic-grocer",
    externalOrderId: "TEST-DISPATCH-1",
    acceptedAt: "2026-08-17T12:02:00.000Z",
    status: "ACCEPTED",
  },
};

describe("D1 TEST dispatch receipt store", () => {
  it("persists and reconstructs a receipt record", async () => {
    const { db } = createFakeD1();
    const store = createD1DispatchReceiptStore(db);

    await store.set(record.receipt.dispatchId, record);
    await expect(store.get(record.receipt.dispatchId)).resolves.toEqual(record);
  });

  it("keeps the first record when the same dispatch ID is written again", async () => {
    const { db } = createFakeD1();
    const store = createD1DispatchReceiptStore(db);
    const conflictingRecord = {
      ...record,
      basketFingerprint: "FP-2",
      receipt: { ...record.receipt, externalOrderId: "TEST-DISPATCH-2" },
    };

    await store.set(record.receipt.dispatchId, record);
    await store.set(record.receipt.dispatchId, conflictingRecord);

    await expect(store.get(record.receipt.dispatchId)).resolves.toEqual(record);
  });

  it("fails closed on malformed persisted receipt state", async () => {
    const { db, rows } = createFakeD1();
    rows.set(record.receipt.dispatchId, {
      dispatch_id: record.receipt.dispatchId,
      basket_id: record.basketId,
      basket_version: record.basketVersion,
      basket_fingerprint: record.basketFingerprint,
      retailer: record.retailer,
      external_order_id: record.receipt.externalOrderId,
      accepted_at: record.receipt.acceptedAt,
      status: "BROKEN",
    });

    const store = createD1DispatchReceiptStore(db);
    await expect(store.get(record.receipt.dispatchId)).rejects.toThrow("malformed record");
  });

  it("fails closed when the persisted receipt timestamp is invalid", async () => {
    const { db, rows } = createFakeD1();
    rows.set(record.receipt.dispatchId, {
      dispatch_id: record.receipt.dispatchId,
      basket_id: record.basketId,
      basket_version: record.basketVersion,
      basket_fingerprint: record.basketFingerprint,
      retailer: record.retailer,
      external_order_id: record.receipt.externalOrderId,
      accepted_at: "not-a-timestamp",
      status: "ACCEPTED",
    });

    const store = createD1DispatchReceiptStore(db);
    await expect(store.get(record.receipt.dispatchId)).rejects.toThrow("malformed record");
  });
});
