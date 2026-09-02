/**
 * Runtime/operator approval handoff for sealed human delivery evidence.
 *
 * This is deliberately the narrowest possible integration between two things
 * that already exist:
 *   - `prepareDeliveryEvidenceHandoff()` (verify + canonicalise sealed evidence)
 *   - the canonical `HouseholdEventWriter` append boundary
 *
 * It introduces NO new authority model. Authority is carried only by the
 * existing `AppendAuthorization`, and every authorization decision (approved,
 * scope-bound to Event ID + payload hash, evidence source, Test-class refusal,
 * duplicate/conflict handling, connector provenance) is delegated unchanged to
 * the writer. This module only routes: a canonical record for which no exact
 * Event ID + payload-hash-bound approval was supplied is PROPOSED, never
 * appended.
 */

import type {
  AppendAuthorization,
  AppendReceipt,
  CanonicalAppendRecord,
} from "../event-writer/types";
import type { HouseholdEventWriter } from "../event-writer/writer";
import { prepareDeliveryEvidenceHandoff } from "./delivery-evidence-handoff";
import type { HumanDeliveryEvidence } from "./delivery-evidence";

export type DeliveryEvidenceReleaseResult =
  | {
      ok: true;
      records: readonly CanonicalAppendRecord[];
      receipts: readonly AppendReceipt[];
      appended: number;
      proposed: number;
      duplicates: number;
      rejected: number;
      /** True only if at least one record actually reached the connector. */
      written: boolean;
    }
  | { ok: false; code: "INVALID_EVIDENCE" | "CANONICALISATION_FAILED"; detail: string };

/**
 * Exact match only: an approval must name this Event ID *and* this payload
 * hash. A same-Event-ID approval with a different hash is still handed to the
 * writer so the canonical AUTHORIZATION_SCOPE_MISMATCH refusal is produced
 * rather than silently downgrading to a proposal.
 */
function approvalFor(
  record: CanonicalAppendRecord,
  approvals: readonly AppendAuthorization[],
): AppendAuthorization | undefined {
  return (
    approvals.find(
      (a) => a.eventId === record.eventId && a.payloadHash === record.payloadHash,
    ) ?? approvals.find((a) => a.eventId === record.eventId)
  );
}

export async function releaseDeliveryEvidenceAppends(input: {
  evidence: HumanDeliveryEvidence;
  writer: HouseholdEventWriter;
  approvals?: readonly AppendAuthorization[];
  now?: () => string;
}): Promise<DeliveryEvidenceReleaseResult> {
  const handoff = input.now
    ? prepareDeliveryEvidenceHandoff(input.evidence, input.now)
    : prepareDeliveryEvidenceHandoff(input.evidence);
  if (!handoff.ok) return handoff;

  const approvals = input.approvals ?? [];
  const receipts: AppendReceipt[] = [];

  for (const record of handoff.records) {
    const approval = approvalFor(record, approvals);
    if (!approval) {
      // No explicit human authority for this exact event: propose only.
      receipts.push(input.writer.propose(record));
      continue;
    }
    receipts.push(await input.writer.append(record, approval));
  }

  const count = (predicate: (r: AppendReceipt) => boolean) => receipts.filter(predicate).length;

  return {
    ok: true,
    records: handoff.records,
    receipts,
    appended: count((r) => r.written),
    proposed: count((r) => r.outcome === "PROPOSED"),
    duplicates: count((r) => r.outcome === "DUPLICATE_NOOP"),
    rejected: count((r) => r.outcome === "REJECTED"),
    written: receipts.some((r) => r.written),
  };
}
