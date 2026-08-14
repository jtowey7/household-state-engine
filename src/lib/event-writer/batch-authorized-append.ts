import { hashOf } from "../state-engine/hash";
import { isCanonicalAppendRecord } from "./canonical";
import type {
  AppendAuthorization,
  AppendReceipt,
  BatchAppendAuthorization,
  CanonicalAppendRecord,
  HouseholdEventWriter,
  WriterRejection,
} from "./types";
import type { HouseholdEventWriter as HouseholdEventWriterContract } from "./writer";

const ACCEPTED_EVIDENCE = new Set(["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"]);

/** Deterministic identity of the complete canonical batch. */
export function batchFingerprintFor(records: readonly CanonicalAppendRecord[]): string {
  return hashOf(
    [...records]
      .map((record) => ({ eventId: record.eventId, payloadHash: record.payloadHash }))
      .sort((a, b) => `${a.eventId}\u0000${a.payloadHash}`.localeCompare(`${b.eventId}\u0000${b.payloadHash}`)),
  );
}

function rejectedReceipt(rejection: WriterRejection): AppendReceipt {
  return {
    receiptId: `BATCH-${hashOf(rejection).slice(0, 16)}`,
    eventId: "",
    payloadHash: "",
    outcome: "REJECTED",
    written: false,
    connector: null,
    authorization: null,
    table: "HOUSEHOLD EVENTS",
    inventoryMutated: false,
    rejection,
  };
}

/**
 * Executes one snapshot-scoped baseline authority without weakening the normal
 * event-level writer. All batch checks happen before the first append call;
 * subsequent individual appends inherit the writer's existing idempotency and
 * production-provenance gates, making a partial connector failure resumable.
 */
export async function appendAuthorisedBatch(
  writer: HouseholdEventWriterContract,
  records: readonly CanonicalAppendRecord[],
  authorization?: BatchAppendAuthorization,
): Promise<AppendReceipt[]> {
  if (!authorization || records.length === 0) {
    return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_INVALID", detail: "A non-empty canonical batch and explicit batch authorization are required." })];
  }
  if (authorization.decision !== "APPROVED" || !ACCEPTED_EVIDENCE.has(authorization.evidenceSource)) {
    return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_INVALID", detail: "Batch authority must be APPROVED and rely on accepted evidence." })];
  }
  if (!authorization.snapshotId.trim() || authorization.eventCount !== records.length) {
    return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_SCOPE_MISMATCH", detail: "Batch snapshot ID and approved event count must exactly match the proposed batch." })];
  }
  if (!records.every(isCanonicalAppendRecord)) {
    return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_INVALID", detail: "Every batch member must be a canonical append record." })];
  }
  if (records.some((record) => record.row["Record class"] !== "Production")) {
    return [rejectedReceipt({ code: "TEST_RECORD_REFUSED", detail: "A production baseline batch cannot contain Test-class records." })];
  }

  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.eventId)) {
      return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_INVALID", detail: `Batch contains Event ID ${record.eventId} more than once.` })];
    }
    ids.add(record.eventId);
  }

  if (batchFingerprintFor(records) !== authorization.batchFingerprint) {
    return [rejectedReceipt({ code: "BATCH_AUTHORIZATION_SCOPE_MISMATCH", detail: "The approved batch fingerprint does not match the complete canonical batch." })];
  }

  const receipts: AppendReceipt[] = [];
  for (const record of records) {
    const eventAuthorization: AppendAuthorization = {
      authorizationId: `${authorization.authorizationId}:${record.eventId}`,
      decision: "APPROVED",
      approvedBy: authorization.approvedBy,
      approvedAt: authorization.approvedAt,
      evidenceSource: authorization.evidenceSource,
      evidenceDetail: authorization.evidenceDetail,
      eventId: record.eventId,
      payloadHash: record.payloadHash,
      actionPolicyReference: authorization.actionPolicyReference,
    };
    receipts.push(await writer.append(record, eventAuthorization));
  }
  return receipts;
}
