import { validateBasketApproval, type BasketApproval } from "./approval";
import { hashOf } from "../state-engine/hash";
import type { CandidateBasket } from "./types";
import { validateDispatchEvidence, type DispatchIntent } from "./dispatch";

export type DispatchReceipt = {
  dispatchId: string;
  retailer: string;
  externalOrderId: string;
  acceptedAt: string;
  status: "ACCEPTED";
};

export interface DispatchAdapter {
  /**
   * Execution boundary: implementations must re-check approval and dispatch
   * evidence against the current basket before any external mutation. The
   * interface deliberately exposes no household-state write capability.
   */
  dispatch(
    intent: DispatchIntent,
    approval: BasketApproval,
    currentBasket: CandidateBasket,
  ): Promise<DispatchReceipt>;
}

type TestDispatchAdapterOptions = {
  acceptedAt?: string;
  now?: string;
  receiptStore?: DispatchReceiptStore;
};

export type DispatchRecord = {
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
  retailer: string;
  receipt: DispatchReceipt;
};

export type DispatchReceiptStore = {
  get(dispatchId: string): DispatchRecord | undefined | Promise<DispatchRecord | undefined>;
  set(dispatchId: string, record: DispatchRecord): void | Promise<void>;
};

function sameDispatchRecord(
  existing: DispatchRecord,
  intent: DispatchIntent,
  intentCreatedTime: number,
  executionTime: number,
): boolean {
  const acceptedAtTime = Date.parse(existing.receipt.acceptedAt);
  return (
    existing.basketId === intent.basketId &&
    existing.basketVersion === intent.basketVersion &&
    existing.basketFingerprint === intent.basketFingerprint &&
    existing.retailer === intent.retailer &&
    existing.receipt.dispatchId === intent.dispatchId &&
    existing.receipt.retailer === intent.retailer &&
    existing.receipt.status === "ACCEPTED" &&
    existing.receipt.externalOrderId === `TEST-${intent.dispatchId}` &&
    !Number.isNaN(acceptedAtTime) &&
    acceptedAtTime >= intentCreatedTime &&
    acceptedAtTime <= executionTime
  );
}

/** Serializes same-dispatch-id work so an asynchronous receipt store cannot race get/set. */
function createDispatchLock() {
  const locks = new Map<string, Promise<void>>();

  return async function withDispatchLock<T>(dispatchId: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(dispatchId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(dispatchId, current);

    if (previous) await previous;
    try {
      return await work();
    } finally {
      release();
      if (locks.get(dispatchId) === current) locks.delete(dispatchId);
    }
  };
}

/**
 * TEST-only adapter. It exercises the execution contract without retailer I/O.
 * The same intent is idempotent; a conflicting reuse is rejected.
 *
 * A receipt store may be injected so adapter instances can be recreated without
 * losing dispatch identity state. Stores may be process-local or backed by the
 * owned TEST D1 runtime; the persistence/concurrency evidence must remain
 * explicitly scoped to the store actually used by the acceptance test.
 */
export function createTestDispatchAdapter(options: TestDispatchAdapterOptions = {}): DispatchAdapter {
  const acceptedAt = options.acceptedAt ?? "2026-08-17T00:00:00.000Z";
  const now = options.now ?? acceptedAt;
  const receipts: DispatchReceiptStore = options.receiptStore ?? new Map<string, DispatchRecord>();
  const withDispatchLock = createDispatchLock();

  return {
    async dispatch(intent, approval, currentBasket) {
      return withDispatchLock(intent.dispatchId, async () => {
        const executionTime = Date.parse(now);
        if (Number.isNaN(executionTime)) {
          throw new Error("Cannot dispatch intent: EXECUTION_TIMESTAMP_INVALID");
        }
        const validation = validateBasketApproval(approval, currentBasket, now);
        if (!validation.valid) {
          throw new Error(`Cannot dispatch intent: ${validation.reason}`);
        }
        if (intent.status !== "READY" || intent.requiresExternalDispatch !== true) {
          throw new Error("Cannot dispatch intent: INTENT_NOT_READY");
        }
        if (!intent.createdAt.trim() || Number.isNaN(Date.parse(intent.createdAt))) {
          throw new Error("Cannot dispatch intent: DISPATCH_TIMESTAMP_INVALID");
        }
        if (!intent.expiresAt.trim() || Number.isNaN(Date.parse(intent.expiresAt))) {
          throw new Error("Cannot dispatch intent: DISPATCH_EXPIRY_INVALID");
        }
        if (Date.parse(intent.expiresAt) <= Date.parse(intent.createdAt)) {
          throw new Error("Cannot dispatch intent: DISPATCH_EXPIRY_INVALID");
        }
        const intentCreatedTime = Date.parse(intent.createdAt);
        if (executionTime < intentCreatedTime) {
          throw new Error("Cannot dispatch intent: EXECUTION_BEFORE_INTENT");
        }
        const approvalTime = approval.approvedAt ? Date.parse(approval.approvedAt) : Number.NaN;
        if (Number.isNaN(approvalTime) || approvalTime > intentCreatedTime) {
          throw new Error("Cannot dispatch intent: APPROVAL_TIMESTAMP_INVALID");
        }
        if (intent.basketId !== currentBasket.basketId) {
          throw new Error("Cannot dispatch intent: BASKET_CHANGED");
        }
        if (intent.basketVersion !== approval.basketVersion) {
          throw new Error("Cannot dispatch intent: VERSION_MISMATCH");
        }
        if (intent.basketFingerprint !== approval.basketFingerprint) {
          throw new Error("Cannot dispatch intent: BASKET_CHANGED");
        }
        if (intent.retailer !== currentBasket.retailer || !intent.retailer) {
          throw new Error("Cannot dispatch intent: RETAILER_MISMATCH");
        }
        try {
          validateDispatchEvidence(intent.evidence, currentBasket);
        } catch (error) {
          throw new Error(`Cannot dispatch intent: ${String(error).replace(/^Error: /, "")}`);
        }

        const canonicalDispatchId = hashOf({
          basketId: currentBasket.basketId,
          basketVersion: approval.basketVersion,
          basketFingerprint: approval.basketFingerprint,
          retailer: currentBasket.retailer,
          evidence: intent.evidence,
        });
        if (intent.dispatchId !== canonicalDispatchId) {
          throw new Error("Cannot dispatch intent: DISPATCH_ID_INVALID");
        }

        const acceptedAtTime = Date.parse(acceptedAt);
        if (Number.isNaN(acceptedAtTime)) {
          throw new Error("Cannot dispatch intent: ACCEPTED_TIMESTAMP_INVALID");
        }
        if (acceptedAtTime < intentCreatedTime || acceptedAtTime > executionTime) {
          throw new Error("Cannot dispatch intent: ACCEPTED_TIMESTAMP_INVALID");
        }

        const existing = await receipts.get(intent.dispatchId);
        if (existing) {
          if (!sameDispatchRecord(existing, intent, intentCreatedTime, executionTime)) {
            throw new Error("Cannot dispatch intent: DISPATCH_ID_CONFLICT");
          }
          return existing.receipt;
        }

        if (executionTime >= Date.parse(intent.expiresAt)) {
          throw new Error("Cannot dispatch intent: DISPATCH_INTENT_EXPIRED");
        }

        const receipt: DispatchReceipt = {
          dispatchId: intent.dispatchId,
          retailer: intent.retailer,
          externalOrderId: `TEST-${intent.dispatchId}`,
          acceptedAt,
          status: "ACCEPTED",
        };
        await receipts.set(intent.dispatchId, {
          basketId: intent.basketId,
          basketVersion: intent.basketVersion,
          basketFingerprint: intent.basketFingerprint,
          retailer: intent.retailer,
          receipt,
        });

        const stored = await receipts.get(intent.dispatchId);
        if (!stored) {
          throw new Error("Cannot dispatch intent: RECEIPT_PERSISTENCE_FAILED");
        }
        if (!sameDispatchRecord(stored, intent, intentCreatedTime, executionTime)) {
          throw new Error("Cannot dispatch intent: DISPATCH_ID_CONFLICT");
        }
        return stored.receipt;
      });
    },
  };
}
