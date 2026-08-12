/**
 * Food OS — deterministic FEEDBACK attention classifier + propagation gate.
 *
 * Boundary: pure, synthetic/test-only. No I/O, no Airtable, no household
 * writes. Classification produces *proposals* only — nothing is applied,
 * dispatched, or turned into confirmed household state here.
 */

export type RecordClass = "Production" | "Test";

export type AttentionLevel = "LOCAL" | "DURABLE" | "CRITICAL";

/** Areas of the Food OS pipeline a proposal could ever touch. */
export type AffectedArea =
  | "MEAL_PLANNING"
  | "RECIPE_SELECTION"
  | "QUANTITIES"
  | "SHOPPING_BASKET"
  | "SUBSTITUTIONS"
  | "APPROVAL_GATE"
  | "WASTE_FORECAST";

export type ConsequenceKind = "NOTE" | "PREFERENCE" | "RULE";

export type PropagationDecision =
  /** Stays on the observation only; never becomes a rule or preference. */
  | "LOCAL_ONLY"
  /** Would shape future planning/procurement in the affected areas. */
  | "PROPAGATE_TO_AREAS"
  /** Safety-critical: blocks affected downstream actions until proven. */
  | "BLOCK_DOWNSTREAM"
  /** Evidence insufficient or ambiguous — explicitly not propagated. */
  | "WITHHELD_AMBIGUOUS";

export type FeedbackExceptionCode =
  | "REUSED_FEEDBACK_ID_PAYLOAD_CONFLICT"
  | "DUPLICATE_REPORT_IGNORED"
  | "TEST_RECORD_EXCLUDED"
  | "INSUFFICIENT_EVIDENCE";

/** One raw household report. Evidence, never confirmed state. */
export interface FeedbackReport {
  /** Immutable Feedback ID. Applied at most once. */
  feedbackId: string;
  recordClass: RecordClass;
  /** Canonical subject key, e.g. "leaf-salad". Drives area derivation. */
  subject: string;
  /** Verbatim household text. */
  text: string;
  actor: string;
  evidenceSource: string;
  observedAt: string;
  /** Confirmed-state evidence IDs corroborating the report (may be empty). */
  evidenceRefs?: string[];
  /** Reported as a diagnosed safety constraint (allergy, intolerance). */
  safetyConstraint?: boolean;
  /** Explicit direction of the preference; conflicting values are ambiguous. */
  polarity?: "AVOID" | "PREFER";
}

export interface FeedbackException {
  code: FeedbackExceptionCode;
  feedbackId: string;
  subject: string;
  detail: string;
  /** Only unresolved integrity conflicts block their subject. */
  blocking: boolean;
}

export interface PropagationProposal {
  /** Deterministic ID derived from the canonical proposal core. */
  proposalId: string;
  subject: string;
  attention: AttentionLevel;
  consequence: ConsequenceKind;
  decision: PropagationDecision;
  affectedAreas: AffectedArea[];
  /** Feedback IDs that contributed, in application order. */
  contributingFeedbackIds: string[];
  evidenceRefs: string[];
  occurrences: number;
  /** Proposals are never applied by this module. */
  applied: false;
  dispatched: false;
  requiresHumanApproval: boolean;
  rationale: string;
}

export type ReviewStatus = "CLEAN" | "EXCEPTIONS" | "BLOCKED";

export interface FeedbackReview {
  /** Deterministic hash of the canonical accepted report set. */
  reviewId: string;
  proposals: PropagationProposal[];
  exceptions: FeedbackException[];
  ignoredFeedbackIds: string[];
  /** Areas blocked by hard constraints or unresolved conflicts. */
  blockedAreas: AffectedArea[];
  status: ReviewStatus;
}

export interface DownstreamAction {
  area: AffectedArea;
  subject: string;
}

export interface GateDecision {
  allowed: boolean;
  area: AffectedArea;
  subject: string;
  reasons: string[];
  /** Proposal IDs that constrain this action. */
  constrainingProposalIds: string[];
}
