import { hashOf } from "@/lib/state-engine/hash";

import type {
  AffectedArea,
  AttentionLevel,
  ConsequenceKind,
  DownstreamAction,
  FeedbackException,
  FeedbackReport,
  FeedbackReview,
  GateDecision,
  PropagationDecision,
  PropagationProposal,
  ReviewStatus,
} from "./types";

/** Reports needed before a repeated observation becomes durable. */
export const DURABLE_THRESHOLD = 3;

const LOCAL_AREAS: AffectedArea[] = ["MEAL_PLANNING"];

const DURABLE_AREAS: AffectedArea[] = [
  "MEAL_PLANNING",
  "QUANTITIES",
  "SHOPPING_BASKET",
  "WASTE_FORECAST",
];

const CRITICAL_AREAS: AffectedArea[] = [
  "MEAL_PLANNING",
  "RECIPE_SELECTION",
  "QUANTITIES",
  "SHOPPING_BASKET",
  "SUBSTITUTIONS",
  "APPROVAL_GATE",
];

/** Canonical identity of a report payload; excludes audit-only fields. */
function canonicalPayload(r: FeedbackReport) {
  return {
    subject: r.subject,
    text: r.text,
    safetyConstraint: r.safetyConstraint === true,
    polarity: r.polarity ?? null,
    evidenceRefs: [...(r.evidenceRefs ?? [])].sort(),
  };
}

interface SubjectBucket {
  subject: string;
  reports: FeedbackReport[];
  evidenceRefs: Set<string>;
  polarities: Set<string>;
  safety: boolean;
  conflicted: boolean;
}

function deriveAreas(attention: AttentionLevel): AffectedArea[] {
  if (attention === "CRITICAL") return [...CRITICAL_AREAS];
  if (attention === "DURABLE") return [...DURABLE_AREAS];
  return [...LOCAL_AREAS];
}

/**
 * Deterministically classify feedback reports and emit propagation proposals.
 * Pure: same canonical input set always yields the same review.
 */
export function classifyFeedback(reports: readonly FeedbackReport[]): FeedbackReview {
  const exceptions: FeedbackException[] = [];
  const ignoredFeedbackIds: string[] = [];
  const seen = new Map<string, string>(); // feedbackId -> payload hash
  const buckets = new Map<string, SubjectBucket>();
  const accepted: FeedbackReport[] = [];
  const conflictedSubjects = new Set<string>();

  for (const report of reports) {
    if (report.recordClass === "Test") {
      ignoredFeedbackIds.push(report.feedbackId);
      exceptions.push({
        code: "TEST_RECORD_EXCLUDED",
        feedbackId: report.feedbackId,
        subject: report.subject,
        detail: "Record class = Test has zero effect on propagation.",
        blocking: false,
      });
      continue;
    }

    const payloadHash = hashOf(canonicalPayload(report));
    const previous = seen.get(report.feedbackId);
    if (previous !== undefined) {
      ignoredFeedbackIds.push(report.feedbackId);
      if (previous === payloadHash) {
        exceptions.push({
          code: "DUPLICATE_REPORT_IGNORED",
          feedbackId: report.feedbackId,
          subject: report.subject,
          detail: "Identical duplicate delivery; applied at most once.",
          blocking: false,
        });
      } else {
        conflictedSubjects.add(report.subject);
        exceptions.push({
          code: "REUSED_FEEDBACK_ID_PAYLOAD_CONFLICT",
          feedbackId: report.feedbackId,
          subject: report.subject,
          detail:
            "Feedback ID reused with a different canonical payload; no second application. Subject is blocked until resolved.",
          blocking: true,
        });
      }
      continue;
    }

    seen.set(report.feedbackId, payloadHash);
    accepted.push(report);

    let bucket = buckets.get(report.subject);
    if (!bucket) {
      bucket = {
        subject: report.subject,
        reports: [],
        evidenceRefs: new Set(),
        polarities: new Set(),
        safety: false,
        conflicted: false,
      };
      buckets.set(report.subject, bucket);
    }
    bucket.reports.push(report);
    for (const ref of report.evidenceRefs ?? []) bucket.evidenceRefs.add(ref);
    if (report.polarity) bucket.polarities.add(report.polarity);
    if (report.safetyConstraint) bucket.safety = true;
  }

  const proposals: PropagationProposal[] = [];

  for (const bucket of [...buckets.values()].sort((a, b) =>
    a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0,
  )) {
    const contributingFeedbackIds = bucket.reports.map((r) => r.feedbackId);
    const evidenceRefs = [...bucket.evidenceRefs].sort();
    const occurrences = bucket.reports.length;
    const ambiguousPolarity = bucket.polarities.size > 1;

    let attention: AttentionLevel;
    let consequence: ConsequenceKind;
    let decision: PropagationDecision;
    let rationale: string;

    if (bucket.safety) {
      attention = "CRITICAL";
      consequence = "RULE";
      decision = "BLOCK_DOWNSTREAM";
      rationale =
        "Safety-critical report. A single occurrence is sufficient; affected downstream actions fail closed until the rule can be enforced and proven.";
    } else if (ambiguousPolarity) {
      attention = "LOCAL";
      consequence = "NOTE";
      decision = "WITHHELD_AMBIGUOUS";
      rationale =
        "Reports for this subject conflict in direction; evidence is ambiguous, so nothing propagates.";
      exceptions.push({
        code: "INSUFFICIENT_EVIDENCE",
        feedbackId: contributingFeedbackIds[0]!,
        subject: bucket.subject,
        detail: "Conflicting preference direction across reports; propagation withheld.",
        blocking: false,
      });
    } else if (occurrences >= DURABLE_THRESHOLD && evidenceRefs.length > 0) {
      attention = "DURABLE";
      consequence = "PREFERENCE";
      decision = "PROPAGATE_TO_AREAS";
      rationale =
        "Repeated across enough cycles with corroborating confirmed-state evidence — durable enough to shape planning and procurement, not urgent enough to block.";
    } else if (occurrences >= DURABLE_THRESHOLD) {
      attention = "LOCAL";
      consequence = "NOTE";
      decision = "WITHHELD_AMBIGUOUS";
      rationale =
        "Repeated but uncorroborated: no confirmed-state evidence supports it, so it stays evidence and does not propagate.";
      exceptions.push({
        code: "INSUFFICIENT_EVIDENCE",
        feedbackId: contributingFeedbackIds[0]!,
        subject: bucket.subject,
        detail: "Repeated reports without confirmed-state evidence; propagation withheld.",
        blocking: false,
      });
    } else {
      attention = "LOCAL";
      consequence = "NOTE";
      decision = "LOCAL_ONLY";
      rationale =
        "Observed too few times to be durable. Kept against the observation only; one reaction is not a preference.";
    }

    const affectedAreas =
      decision === "WITHHELD_AMBIGUOUS" ? [] : deriveAreas(attention);

    const core = {
      subject: bucket.subject,
      attention,
      consequence,
      decision,
      affectedAreas,
      contributingFeedbackIds,
      evidenceRefs,
    };

    proposals.push({
      proposalId: `FBP-${hashOf(core)}`,
      subject: bucket.subject,
      attention,
      consequence,
      decision,
      affectedAreas,
      contributingFeedbackIds,
      evidenceRefs,
      occurrences,
      applied: false,
      dispatched: false,
      requiresHumanApproval: decision !== "LOCAL_ONLY" && decision !== "WITHHELD_AMBIGUOUS",
      rationale,
    });
  }

  const blockedAreaSet = new Set<AffectedArea>();
  for (const proposal of proposals) {
    if (proposal.decision === "BLOCK_DOWNSTREAM") {
      for (const area of proposal.affectedAreas) blockedAreaSet.add(area);
    }
  }

  const hasBlocking =
    blockedAreaSet.size > 0 ||
    exceptions.some((e) => e.blocking) ||
    conflictedSubjects.size > 0;

  const status: ReviewStatus = hasBlocking
    ? "BLOCKED"
    : exceptions.length > 0
      ? "EXCEPTIONS"
      : "CLEAN";

  return {
    reviewId: `FBR-${hashOf(accepted.map(canonicalPayload))}`,
    proposals,
    exceptions,
    ignoredFeedbackIds,
    blockedAreas: [...blockedAreaSet].sort(),
    status,
  };
}

/** Subjects blocked by an unresolved integrity conflict. */
function conflictedSubjectsOf(review: FeedbackReview): Set<string> {
  const set = new Set<string>();
  for (const e of review.exceptions) if (e.blocking) set.add(e.subject);
  return set;
}

/**
 * Propagation gate: decides whether a downstream planning/procurement action
 * may proceed given a classified review. Fails closed for hard constraints
 * and unresolved conflicts on the same subject.
 */
export function evaluateDownstreamAction(
  review: FeedbackReview,
  action: DownstreamAction,
): GateDecision {
  const reasons: string[] = [];
  const constrainingProposalIds: string[] = [];
  let allowed = true;

  if (conflictedSubjectsOf(review).has(action.subject)) {
    allowed = false;
    reasons.push(
      `Unresolved feedback integrity conflict on "${action.subject}"; downstream action refused.`,
    );
  }

  for (const proposal of review.proposals) {
    if (proposal.decision === "BLOCK_DOWNSTREAM" && proposal.affectedAreas.includes(action.area)) {
      allowed = false;
      constrainingProposalIds.push(proposal.proposalId);
      reasons.push(
        `Hard constraint from "${proposal.subject}" blocks ${action.area} until it is enforced and proven.`,
      );
      continue;
    }
    if (
      proposal.decision === "PROPAGATE_TO_AREAS" &&
      proposal.subject === action.subject &&
      proposal.affectedAreas.includes(action.area)
    ) {
      constrainingProposalIds.push(proposal.proposalId);
      reasons.push(
        `Durable preference from "${proposal.subject}" shapes ${action.area} (proposal only; requires approval).`,
      );
    }
  }

  if (reasons.length === 0) reasons.push("No feedback constrains this action.");

  return { allowed, area: action.area, subject: action.subject, reasons, constrainingProposalIds };
}
