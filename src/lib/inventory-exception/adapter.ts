/**
 * Food OS — USER-REPORTED INVENTORY EXCEPTION -> CANONICAL CORRECTION PROPOSAL.
 *
 * PREPARE only. This module maps an explicit human stock report onto the
 * existing canonical `Correction` path and returns previews
 * (`wouldWrite: false`, `requiresHumanAuthorization: true`). It holds no port,
 * so it is structurally unable to write Airtable or mutate INVENTORY.
 */

import { hashOf } from "../state-engine/hash";
import { canonicaliseAppend } from "../event-writer/canonical";
import { previewOfRecord } from "../event-writer/preview";
import type { AppendIntent } from "../write-boundary/types";
import { HOUSEHOLD_UNIT_CONTRACT, normaliseHouseholdUnit } from "./unit-contract";
import type {
  StockCorrectionProposal,
  StockExceptionFingerprint,
  StockExceptionProposalOptions,
  StockExceptionProposalRun,
  StockExceptionRejection,
  UserReportedStockException,
} from "./types";

export const DEFAULT_EXCEPTION_UNITS = HOUSEHOLD_UNIT_CONTRACT;

export function proposalKeyFor(exceptionId: string, itemKey: string): string {
  return `exception::${exceptionId}::${itemKey}`;
}

type QuantityOutcome =
  | { ok: true; stateAfter: number }
  | { ok: false; code: StockExceptionRejection["code"]; detail: string };

/**
 * Reads the stated state-after EXACTLY as reported. A missing value is
 * missing, a non-numeric value is ambiguous, and neither is ever parsed,
 * rounded, or guessed into a quantity.
 */
export function readStatedStateAfter(
  value: UserReportedStockException["statedStateAfter"],
): QuantityOutcome {
  if (value === undefined || value === null || value === "") {
    return {
      ok: false,
      code: "MISSING_QUANTITY",
      detail: "The report states no quantity; a Correction quantity is never inferred.",
    };
  }
  if (typeof value !== "number") {
    return {
      ok: false,
      code: "AMBIGUOUS_QUANTITY",
      detail: `The reported quantity \`${String(value)}\` is not an unambiguous number; it is refused rather than interpreted.`,
    };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, code: "AMBIGUOUS_QUANTITY", detail: "The reported quantity is not a finite number." };
  }
  if (value < 0) {
    return { ok: false, code: "INVALID_QUANTITY", detail: `A reported state-after of ${value} is not a valid on-hand quantity.` };
  }
  return { ok: true, stateAfter: value };
}

/**
 * Turns explicit user-reported stock exceptions into canonical Correction
 * proposals. Repeated evaluation of the same exception is idempotent; a
 * changed quantity or materially changed evidence/provenance surfaces a
 * conflict instead of overwriting the earlier proposal.
 */
export function proposeStockExceptionCorrections(
  reports: readonly UserReportedStockException[],
  options: StockExceptionProposalOptions,
): StockExceptionProposalRun {
  const allowedUnits = options.allowedUnits ?? [...DEFAULT_EXCEPTION_UNITS];
  const known = new Map<string, StockExceptionFingerprint>();
  for (const fp of options.knownProposals ?? []) known.set(fp.proposalKey, fp);

  const proposals: StockCorrectionProposal[] = [];
  const deduped: StockExceptionFingerprint[] = [];
  const rejections: StockExceptionRejection[] = [];

  const ordered = [...reports].sort((a, b) =>
    a.exceptionId === b.exceptionId
      ? a.itemKey.localeCompare(b.itemKey)
      : a.exceptionId.localeCompare(b.exceptionId),
  );

  for (const report of ordered) {
    const itemKey = report.itemKey?.trim() ?? "";
    const base = { exceptionId: report.exceptionId, itemKey: itemKey || null };
    const reject = (code: StockExceptionRejection["code"], detail: string) =>
      rejections.push({ ...base, code, detail });

    if (!itemKey) {
      reject("MISSING_ITEM", "The report names no item.");
      continue;
    }
    if (!report.observedAt?.trim()) {
      reject("MISSING_OCCURRED_AT", `${itemKey}: the report states no observation time.`);
      continue;
    }
    const reason = report.reason?.trim() ?? "";
    if (!reason) {
      reject("MISSING_REASON", `${itemKey}: an exception must carry a reconciliation reason.`);
      continue;
    }
    const evidence = report.evidence?.trim() ?? "";
    if (!evidence) {
      reject(
        "MISSING_EVIDENCE",
        `${itemKey}: explicit user evidence is required; an unevidenced correction is refused.`,
      );
      continue;
    }
    const actor = report.reportedBy?.trim() || options.actor?.trim() || "";
    const source = report.source?.trim() || options.source?.trim() || "";
    if (!actor || !source) {
      reject("MISSING_ACTOR_OR_SOURCE", `${itemKey}: a report must name both the reporting human and the source.`);
      continue;
    }
    const unit = (report.unit ?? "").trim();
    if (!unit) {
      reject("MISSING_UNIT", `${itemKey}: the report states no unit; a unit is never assumed.`);
      continue;
    }
    if (!allowedUnits.includes(unit)) {
      reject("MISSING_UNIT", `${itemKey}: unit \`${unit}\` is not in the household unit contract.`);
      continue;
    }

    const quantity = readStatedStateAfter(report.statedStateAfter);
    if (!quantity.ok) {
      reject(quantity.code, `${itemKey}: ${quantity.detail}`);
      continue;
    }

    const confidence = report.confidence?.trim() || options.confidence || "High";
    const recordClass = report.recordClass ?? options.recordClass ?? "Production";

    const intent: AppendIntent = {
      eventType: "Correction",
      item: itemKey,
      occurredAt: report.observedAt,
      stateAfter: quantity.stateAfter,
      ...(typeof report.statedStateBefore === "number"
        ? { stateBefore: report.statedStateBefore }
        : {}),
      unit,
      source,
      actor,
      entityType: "Inventory item",
      evidence,
      confidence,
      exceptionAction: reason,
      recordClass,
      // Explicit only: supersession is carried through, never inferred.
      ...(report.supersedes && report.supersedes.length > 0 ? { supersedes: report.supersedes } : {}),
    };

    const canonical = canonicaliseAppend(intent, { now: options.now });
    if (!canonical.ok) {
      reject("CANONICALISATION_REJECTED", `${itemKey}: ${canonical.rejection.code}: ${canonical.rejection.detail}`);
      continue;
    }

    const record = canonical.record;
    const provenanceHash = hashOf({
      exceptionId: report.exceptionId,
      itemKey,
      actor,
      source,
      evidence,
      confidence,
      reason,
      recordClass,
    });
    const fingerprint: StockExceptionFingerprint = {
      proposalKey: proposalKeyFor(report.exceptionId, itemKey),
      eventId: record.eventId,
      payloadHash: record.payloadHash,
      provenanceHash,
    };

    const prior = known.get(fingerprint.proposalKey);
    if (prior) {
      if (prior.payloadHash !== fingerprint.payloadHash) {
        reject(
          "EXCEPTION_PAYLOAD_CONFLICT",
          `${itemKey}: exception ${report.exceptionId} already proposed event ${prior.eventId}; the restated quantity yields ${record.eventId}. Surfaced as a conflict rather than overwriting the prior proposal.`,
        );
        continue;
      }
      if (prior.provenanceHash !== fingerprint.provenanceHash) {
        reject(
          "EXCEPTION_PROVENANCE_CONFLICT",
          `${itemKey}: exception ${report.exceptionId} already proposed event ${prior.eventId} with different evidence/provenance. Surfaced as a conflict rather than overwriting the prior proposal.`,
        );
        continue;
      }
      deduped.push(fingerprint);
      continue;
    }

    known.set(fingerprint.proposalKey, fingerprint);
    proposals.push({
      ...fingerprint,
      exceptionId: report.exceptionId,
      itemKey,
      stateAfter: quantity.stateAfter,
      unit,
      occurredAt: report.observedAt,
      reason,
      recordClass,
      intent,
      record,
      preview: previewOfRecord(record),
      requiresHumanAuthorization: true,
    });
  }

  return {
    proposals,
    deduped,
    rejections,
    fingerprints: [...known.values()].sort((a, b) => a.proposalKey.localeCompare(b.proposalKey)),
  };
}
