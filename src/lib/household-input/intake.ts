/**
 * Food OS — HUMAN DELIVERY / STOCK INPUT -> CANONICAL APPEND PROPOSAL.
 *
 * This is a routing seam only. It introduces no schema, no authority model and
 * no connector:
 *   - a delivery input is sealed by `sealHumanDeliveryEvidence()` and
 *     canonicalised by the existing `prepareDeliveryEvidenceHandoff()`
 *   - a stock correction is canonicalised by the existing
 *     `proposeStockExceptionCorrections()` Correction path
 *   - every resulting canonical record is handed to the EXISTING
 *     `HouseholdEventWriter`, and without an exact Event ID + payload-hash
 *     bound `AppendAuthorization` it is only ever PROPOSED.
 *
 * The default path is non-mutating: `prepareHouseholdIntake()` never appends.
 */

import { canonicaliseAppend } from "../event-writer/canonical";
import { createHouseholdEventWriter } from "../event-writer/writer";
import type { HouseholdEventWriter } from "../event-writer/writer";
import type {
  AppendAuthorization,
  AppendReceipt,
  CanonicalAppendRecord,
} from "../event-writer/types";
import { FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID, FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION } from "../event-writer/gate";
import { proposeStockExceptionCorrections } from "../inventory-exception/adapter";
import { prepareDeliveryEvidenceHandoff } from "../state-engine/delivery-evidence-handoff";
import {
  sealHumanDeliveryEvidence,
  verifyHumanDeliveryEvidence,
} from "../state-engine/delivery-evidence";
import type { HumanDeliveryEvidence } from "../state-engine/delivery-evidence";
import type {
  HouseholdIntakePreparation,
  HouseholdIntakeProvenance,
  HouseholdIntakeSubmission,
  IntakeApprovalRequest,
} from "./types";

export const INTAKE_ACTION_POLICY_REFERENCE =
  "ACTION POLICY: record household event = PREPARE, never auto-execute; explicit human approval required.";

export interface HouseholdIntakeOptions {
  now: () => string;
  /** Optional existing writer. Omitted → a PROPOSE-mode, connector-less writer. */
  writer?: HouseholdEventWriter;
}

function approvalRequestFor(record: CanonicalAppendRecord): IntakeApprovalRequest {
  const row = record.row as unknown as Record<string, unknown>;
  const item = typeof row["Item"] === "string" ? row["Item"] : "";
  const eventType = typeof row["Event type"] === "string" ? row["Event type"] : "";
  const quantityDelta = row["Quantity delta"];
  const stateAfter = row["State after"];
  const unit = typeof row["Unit"] === "string" ? row["Unit"] : "";
  const change =
    typeof quantityDelta === "number"
      ? `${quantityDelta > 0 ? "+" : ""}${quantityDelta} ${unit}`.trim()
      : typeof stateAfter === "number"
        ? `state after ${stateAfter} ${unit}`.trim()
        : "no quantity change stated";

  return {
    eventId: record.eventId,
    payloadHash: record.payloadHash,
    item,
    eventType,
    summary: `${eventType} · ${item} · ${change}`,
    requiredEvidenceSource: "EXPLICIT_USER_INPUT",
    actionPolicyReference: INTAKE_ACTION_POLICY_REFERENCE,
  };
}

function deliveryProvenance(evidence: HumanDeliveryEvidence): HouseholdIntakeProvenance {
  return {
    kind: "DELIVERY",
    evidenceId: evidence.evidenceId,
    basketId: evidence.basketId,
    basketFingerprint: evidence.delivery.basketFingerprint,
    orderReference: evidence.orderReference,
    retailer: evidence.retailer,
    deliveryId: evidence.delivery.deliveryId,
    dispatchId: evidence.delivery.dispatchId,
    capturedBy: evidence.capturedBy,
    capturedAt: evidence.capturedAt,
  };
}

function prepareDelivery(
  submission: Extract<HouseholdIntakeSubmission, { kind: "DELIVERY" }>,
  options: HouseholdIntakeOptions,
):
  | { ok: true; evidence: HumanDeliveryEvidence; records: readonly CanonicalAppendRecord[] }
  | { ok: false; code: "INVALID_EVIDENCE" | "CANONICALISATION_FAILED"; detail: string } {
  const sealed = sealHumanDeliveryEvidence(submission.input);
  if (!sealed.ok) return sealed;
  if (!verifyHumanDeliveryEvidence(sealed.evidence)) {
    return { ok: false, code: "INVALID_EVIDENCE", detail: "Sealed evidence failed verification." };
  }
  const handoff = prepareDeliveryEvidenceHandoff(sealed.evidence, options.now);
  if (!handoff.ok) return handoff;
  return { ok: true, evidence: sealed.evidence, records: handoff.records };
}

function prepareCorrection(
  submission: Extract<HouseholdIntakeSubmission, { kind: "STOCK_CORRECTION" }>,
  options: HouseholdIntakeOptions,
):
  | { ok: true; records: readonly CanonicalAppendRecord[] }
  | { ok: false; code: "STOCK_INPUT_REFUSED"; detail: string } {
  const run = proposeStockExceptionCorrections([submission.report], { now: options.now });
  if (run.rejections.length > 0 || run.proposals.length === 0) {
    const rejection = run.rejections[0];
    return {
      ok: false,
      code: "STOCK_INPUT_REFUSED",
      detail: rejection
        ? `${rejection.code}: ${rejection.detail}`
        : "The stock input produced no canonical correction proposal.",
    };
  }
  return { ok: true, records: run.proposals.map((p) => p.record) };
}

export function prepareHouseholdIntake(
  submission: HouseholdIntakeSubmission,
  options: HouseholdIntakeOptions,
): HouseholdIntakePreparation {
  const writer = options.writer ?? createHouseholdEventWriter();

  let records: readonly CanonicalAppendRecord[];
  let evidence: HumanDeliveryEvidence | null = null;
  let provenance: HouseholdIntakeProvenance;

  if (submission.kind === "DELIVERY") {
    const prepared = prepareDelivery(submission, options);
    if (!prepared.ok) return prepared;
    records = prepared.records;
    evidence = prepared.evidence;
    provenance = deliveryProvenance(prepared.evidence);
  } else {
    const prepared = prepareCorrection(submission, options);
    if (!prepared.ok) return prepared;
    records = prepared.records;
    provenance = {
      kind: "STOCK_CORRECTION",
      exceptionId: submission.report.exceptionId,
      itemKey: submission.report.itemKey,
      reportedBy: submission.report.reportedBy ?? "",
      observedAt: submission.report.observedAt,
      reason: submission.report.reason,
    };
  }

  const receipts: AppendReceipt[] = records.map((record) => writer.propose(record));

  return {
    ok: true,
    kind: submission.kind,
    provenance,
    evidence,
    records,
    approvalRequests: records.map(approvalRequestFor),
    receipts,
    proposed: receipts.filter((r) => r.outcome === "PROPOSED").length,
    requiresHumanAuthorization: true,
    productionMutation: false,
  };
}

export type HouseholdIntakeReleaseResult =
  | {
      ok: true;
      records: readonly CanonicalAppendRecord[];
      receipts: readonly AppendReceipt[];
      appended: number;
      proposed: number;
      duplicates: number;
      rejected: number;
      written: boolean;
    }
  | Extract<HouseholdIntakePreparation, { ok: false }>;

export async function releaseHouseholdIntake(input: {
  submission: HouseholdIntakeSubmission;
  writer: HouseholdEventWriter;
  approvals?: readonly AppendAuthorization[];
  now: () => string;
}): Promise<HouseholdIntakeReleaseResult> {
  const prepared =
    input.submission.kind === "DELIVERY"
      ? prepareDelivery(input.submission, { now: input.now })
      : prepareCorrection(input.submission, { now: input.now });
  if (!prepared.ok) return prepared;

  const approvals = input.approvals ?? [];
  const receipts: AppendReceipt[] = [];

  for (const record of prepared.records) {
    const approval =
      approvals.find((a) => a.eventId === record.eventId && a.payloadHash === record.payloadHash) ??
      approvals.find((a) => a.eventId === record.eventId);
    if (!approval) {
      receipts.push(input.writer.propose(record));
      continue;
    }
    receipts.push(await input.writer.append(record, approval));
  }

  const count = (predicate: (r: AppendReceipt) => boolean) => receipts.filter(predicate).length;
  return {
    ok: true,
    records: prepared.records,
    receipts,
    appended: count((r) => r.written),
    proposed: count((r) => r.outcome === "PROPOSED"),
    duplicates: count((r) => r.outcome === "DUPLICATE_NOOP"),
    rejected: count((r) => r.outcome === "REJECTED"),
    written: receipts.some((r) => r.written),
  };
}

export function authorizationFromRequest(
  request: IntakeApprovalRequest,
  approver: { authorizationId: string; approvedBy: string; approvedAt: string; evidenceDetail: string; evidenceSource?: AppendAuthorization["evidenceSource"] },
): AppendAuthorization {
  return {
    authorizationId: approver.authorizationId,
    decision: "APPROVED",
    approvedBy: approver.approvedBy,
    approvedAt: approver.approvedAt,
    evidenceSource: approver.evidenceSource ?? request.requiredEvidenceSource,
    evidenceDetail: approver.evidenceDetail,
    eventId: request.eventId,
    payloadHash: request.payloadHash,
    actionPolicyReference: request.actionPolicyReference,
    policyIdentity: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_ID,
    policyVersion: FAMILY_ALPHA_HOUSEHOLD_EVENT_POLICY_VERSION,
  };
}

export { canonicaliseAppend };
