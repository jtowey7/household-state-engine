/**
 * Food OS — pure presenter for the FEEDBACK_GATE cycle stage.
 *
 * Read-only projection of an already-produced CycleFeedbackGate into the
 * fields the console renders. No classification, no mutation, no dispatch.
 */

import type { CycleFeedbackGate } from "./cycle-gate";
import type { AffectedArea } from "./types";

export type GateViewStatus = "ALLOWED" | "WARNED" | "REFUSED";

export interface GateProposalView {
  proposalId: string;
  subject: string;
  attention: string;
  consequence: string;
  areas: AffectedArea[];
  occurrences: number;
  rationale: string;
  applied: false;
  dispatched: false;
  requiresHumanApproval: boolean;
}

export interface GateView {
  status: GateViewStatus;
  gateId: string;
  reviewId: string;
  reviewStatus: string;
  gatedAreas: AffectedArea[];
  refusedAreas: AffectedArea[];
  isolatedItemKeys: string[];
  blockingReasons: string[];
  exceptionNotes: string[];
  proposals: GateProposalView[];
  summary: string;
  applied: false;
  dispatched: false;
}

export function describeFeedbackGate(gate: CycleFeedbackGate): GateView {
  const exceptionNotes = gate.review.exceptions.map(
    (e) => `${e.code} · ${e.subject}: ${e.detail}`,
  );

  const status: GateViewStatus = !gate.allowed
    ? "REFUSED"
    : gate.isolatedItemKeys.length > 0 || exceptionNotes.length > 0
      ? "WARNED"
      : "ALLOWED";

  const summary = !gate.allowed
    ? `Refused before quantity planning: ${gate.refusedAreas.join(", ")}.`
    : `Review ${gate.review.status}: ${gate.preferenceProposals.length} durable preference proposal(s), ${gate.isolatedItemKeys.length} item(s) isolated. Nothing applied.`;

  return {
    status,
    gateId: gate.gateId,
    reviewId: gate.review.reviewId,
    reviewStatus: gate.review.status,
    gatedAreas: [...gate.gatedAreas],
    refusedAreas: [...gate.refusedAreas],
    isolatedItemKeys: [...gate.isolatedItemKeys],
    blockingReasons: [...gate.blockingReasons],
    exceptionNotes,
    proposals: gate.preferenceProposals.map((p) => ({
      proposalId: p.proposalId,
      subject: p.subject,
      attention: p.attention,
      consequence: p.consequence,
      areas: [...p.affectedAreas],
      occurrences: p.occurrences,
      rationale: p.rationale,
      applied: false,
      dispatched: false,
      requiresHumanApproval: p.requiresHumanApproval,
    })),
    summary,
    applied: false,
    dispatched: false,
  };
}
