/**
 * Food OS — FEEDBACK propagation gate, wired for the weekly/shadow cycle.
 *
 * Boundary: pure and synthetic/test-only. This module classifies feedback and
 * decides what the cycle may still do BEFORE any quantity or procurement work
 * happens. It never applies a preference, never writes household state and
 * never dispatches. Durable preferences leave here as proposals only.
 */

import { hashOf } from "@/lib/state-engine/hash";

import { classifyFeedback, evaluateDownstreamAction } from "./classifier";
import type {
  AffectedArea,
  FeedbackReport,
  FeedbackReview,
  GateDecision,
  PropagationProposal,
} from "./types";

/** Areas the weekly/shadow cycle is about to execute. */
export const CYCLE_GATED_AREAS: AffectedArea[] = ["QUANTITIES", "SHOPPING_BASKET"];

/** Probe subject with no feedback of its own: isolates area-wide blocks. */
const AREA_PROBE_SUBJECT = "__cycle_area_probe__";

export interface CycleFeedbackGateOptions {
  /** Maps a feedback subject onto demand item keys. Defaults to identity. */
  subjectItemKeys?: Readonly<Record<string, readonly string[]>>;
  /** Demand universe used for identity mapping. */
  itemKeys?: readonly string[];
  /** Override the gated areas (defaults to QUANTITIES + SHOPPING_BASKET). */
  areas?: readonly AffectedArea[];
}

export interface CycleFeedbackGate {
  /** Deterministic ID over the canonical gate outcome. */
  gateId: string;
  review: FeedbackReview;
  /** False when any gated area is refused; the cycle must not plan quantities. */
  allowed: boolean;
  gatedAreas: AffectedArea[];
  refusedAreas: AffectedArea[];
  decisions: GateDecision[];
  /** Item keys withheld from this cycle because their subject is constrained. */
  isolatedItemKeys: string[];
  /** Durable preferences surfaced for human review. Never applied here. */
  preferenceProposals: PropagationProposal[];
  blockingReasons: string[];
  /** Gate output is advisory: nothing is applied or dispatched by this module. */
  readonly applied: false;
  readonly dispatched: false;
}

function itemKeysForSubject(
  subject: string,
  options: CycleFeedbackGateOptions,
): string[] {
  const mapped = options.subjectItemKeys?.[subject];
  if (mapped) return [...mapped];
  const universe = options.itemKeys ?? [];
  return universe.includes(subject) ? [subject] : [];
}

/**
 * Evaluate the propagation gate for one cycle run. Deterministic: the same
 * report set and options always produce the same gate.
 */
export function evaluateCycleFeedbackGate(
  reports: readonly FeedbackReport[] = [],
  options: CycleFeedbackGateOptions = {},
): CycleFeedbackGate {
  const review = classifyFeedback(reports);
  const gatedAreas = [...(options.areas ?? CYCLE_GATED_AREAS)];

  const decisions: GateDecision[] = [];
  const refusedAreas: AffectedArea[] = [];
  const blockingReasons: string[] = [];

  // Area-wide probe: a hard constraint blocks the AREA, regardless of subject.
  for (const area of gatedAreas) {
    const decision = evaluateDownstreamAction(review, {
      area,
      subject: AREA_PROBE_SUBJECT,
    });
    decisions.push(decision);
    if (!decision.allowed) {
      refusedAreas.push(area);
      for (const reason of decision.reasons) blockingReasons.push(`${area}: ${reason}`);
    }
  }

  // Subject-level constraints isolate their items instead of the whole run.
  const isolated = new Set<string>();
  const constrainedSubjects = new Set<string>();
  for (const exception of review.exceptions) {
    if (exception.blocking) constrainedSubjects.add(exception.subject);
  }
  for (const proposal of review.proposals) {
    if (proposal.decision === "BLOCK_DOWNSTREAM") constrainedSubjects.add(proposal.subject);
  }
  for (const subject of constrainedSubjects) {
    for (const key of itemKeysForSubject(subject, options)) isolated.add(key);
  }

  const preferenceProposals = review.proposals.filter(
    (p) =>
      p.decision === "PROPAGATE_TO_AREAS" &&
      p.affectedAreas.some((a) => gatedAreas.includes(a)),
  );

  const isolatedItemKeys = [...isolated].sort();
  const allowed = refusedAreas.length === 0;

  return {
    gateId: `FBG-${hashOf({
      reviewId: review.reviewId,
      gatedAreas,
      refusedAreas,
      isolatedItemKeys,
      preferenceProposalIds: preferenceProposals.map((p) => p.proposalId),
    })}`,
    review,
    allowed,
    gatedAreas,
    refusedAreas: [...refusedAreas].sort(),
    decisions,
    isolatedItemKeys,
    preferenceProposals,
    blockingReasons,
    applied: false,
    dispatched: false,
  };
}
