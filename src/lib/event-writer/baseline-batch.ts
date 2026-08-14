/** Snapshot-scoped one-time baseline batch orchestration.
 *
 * The household-event writer deliberately exposes exactly one write verb:
 * append(). This helper performs batch preflight, then delegates every actual
 * write to that single append seam with event-scoped approvals derived only
 * from the already-approved immutable batch authority.
 */

import { hashOf } from "../state-engine/hash";
import { isCanonicalAppendRecord } from "./canonical";
import type {
  AppendReceipt,
  BatchAppendAuthorization,
  CanonicalAppendRecord,
} from "./types";
import type { HouseholdEventWriter } from "./writer";

export function batchFingerprintFor(records: readonly CanonicalAppendRecord[]): string {
  return hashOf(
    [...records]
      .map((record) => ({ eventId: record.eventId, payloadHash: record.payloadHash }))
      .sort((a, b) => `${a.eventId}\u0000${a.payloadHash}`.localeCompare(`${b.eventId}\u0000${b.payloadHash}`)),
  );
}

export async function appendBaselineBatch(
  writer: HouseholdEventWriter,
  records: readonly CanonicalAppendRecord[],
  authorization?: BatchAppendAuthorization,
): Promise<AppendReceipt[]> {
  const reject = (
    code: "BATCH_AUTHORIZATION_INVALID" | "BATCH_AUTHORIZATION_SCOPE_MISMATCH" | "TEST_RECORD_REFUSED",
    detail: string,
  ): AppendReceipt[] => [
    {
      receiptId: `RCPT-${hashOf({ code, detail }).slice(0, 16)}`,
      eventId: "",
      payloadHash: "",
      outcome: "REJECTED",
      written: false,
      connector: null,
      authorization: null,
      table: "HOUSEHOLD EVENTS",
      inventoryMutated: false,
      rejection: { code, detail },
    },
  ];

  if (records.length === 0 || !authorization) {
    return reject("BATCH_AUTHORIZATION_INVALID", "A non-empty canonical batch and explicit batch authorization are required.");
  }
  if (
    authorization.decision !== "APPROVED" ||
    !["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"].includes(authorization.evidenceSource)
  ) {
    return reject("BATCH_AUTHORIZATION_INVALID", "Batch authority must be APPROVED and rely on accepted evidence.");
  }
  if (!authorization.snapshotId.trim() || authorization.eventCount !== records.length) {
    return reject("BATCH_AUTHORIZATION_SCOPE_MISMATCH", "Batch snapshot ID and approved event count must exactly match the proposed batch.");
  }
  if (!records.every(isCanonicalAppendRecord)) {
    return reject("BATCH_AUTHORIZATION_INVALID", "Every batch member must be a canonical append record.");
  }
  if (records.some((record) => record.row["Record class"] !== "Production")) {
    return reject("TEST_RECORD_REFUSED", "A production baseline batch cannot contain Test-class records.");
  }

  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.eventId)) {
      return reject("BATCH_AUTHORIZATION_INVALID", `Batch contains Event ID ${record.eventId} more than once.`);
    }
    ids.add(record.eventId);
  }

  if (batchFingerprintFor(records) !== authorization.batchFingerprint) {
    return reject("BATCH_AUTHORIZATION_SCOPE_MISMATCH", "The approved batch fingerprint does not match the complete canonical batch.");
  }

  const receipts: AppendReceipt[] = [];
  for (const record of records) {
    receipts.push(
      await writer.append(record, {
        authorizationId: `${authorization.authorizationId}:${record.eventId}`,
        decision: "APPROVED",
        approvedBy: authorization.approvedBy,
        approvedAt: authorization.approvedAt,
        evidenceSource: authorization.evidenceSource,
        evidenceDetail: authorization.evidenceDetail,
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        actionPolicyReference: authorization.actionPolicyReference,
      }),
    );
  }
  return receipts;
}
