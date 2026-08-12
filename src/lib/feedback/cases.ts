/**
 * Food OS — feedback review & propagation status (READ-ONLY, SYNTHETIC).
 *
 * Boundary: this module is presentation-grade data only. It classifies
 * synthetic household feedback into attention levels and describes what
 * propagation *would* require. It performs no I/O, writes nothing, creates no
 * preferences or rules, and does not touch the state engine, Airtable or any
 * household data. Executable propagation is intentionally absent: the owned
 * Food OS runtime is not provisioned.
 */

export type AttentionLevel = "LOCAL" | "DURABLE" | "CRITICAL";

/** Propagation is never "done" in this slice — nothing executes. */
export type PropagationStatus = "NOT_STARTED" | "AWAITING_RUNTIME" | "PROVEN";

export type ConsequenceKind = "NOTE" | "PREFERENCE" | "RULE" | "TASK";

export interface FeedbackConsequence {
  kind: ConsequenceKind;
  /** What Food OS *would* create. Not created here. */
  label: string;
  detail: string;
}

export interface FeedbackCase {
  feedbackId: string;
  /** Verbatim household report. */
  text: string;
  /** Where the report came from, for provenance. */
  evidenceSource: string;
  actor: string;
  observedAt: string;
  /** How many times this has been observed in the synthetic history. */
  occurrences: number;
  attention: AttentionLevel;
  /** Planning / procurement areas this would touch. */
  affectedAreas: string[];
  propagation: PropagationStatus;
  consequence: FeedbackConsequence | null;
  /** What must be proven before this could ever propagate. */
  regressionRequirement: string;
  /** Only a hard constraint blocks and escalates. */
  blocking: boolean;
  escalation: string | null;
  /** Plain-language reason for the attention level. */
  rationale: string;
}

export const RUNTIME_NOT_PROVISIONED =
  "Executable propagation is not available yet: the owned Food OS runtime is not provisioned. Everything below is a synthetic review of what Food OS would do — nothing has been applied, saved or sent.";

export const attentionMeta: Record<
  AttentionLevel,
  { label: string; blurb: string; order: number }
> = {
  LOCAL: {
    label: "Local attention",
    blurb: "Noted once. Does not become a rule.",
    order: 0,
  },
  DURABLE: {
    label: "Durable preference",
    blurb: "Seen enough times to shape future planning.",
    order: 1,
  },
  CRITICAL: {
    label: "Hard constraint",
    blurb: "Safety-critical. Blocks planning and escalates until proven.",
    order: 2,
  },
};

/* ---------------------------------------------------------------- *
 * SYNTHETIC EXAMPLE FEEDBACK — illustration only.
 * ---------------------------------------------------------------- */

export const FEEDBACK_CASES: readonly FeedbackCase[] = [
  {
    feedbackId: "FB-DEMO-001",
    text: "Didn't love the miso butter greens on Monday — a bit rich for a weeknight.",
    evidenceSource: "tell-food-os:FREE_TEXT",
    actor: "James",
    observedAt: "2026-02-09T20:10:00.000Z",
    occurrences: 1,
    attention: "LOCAL",
    affectedAreas: ["This week's plan"],
    propagation: "NOT_STARTED",
    consequence: {
      kind: "NOTE",
      label: "Meal note on Monday's miso butter greens",
      detail: "Kept against the meal only. No preference is created from a single reaction.",
    },
    regressionRequirement:
      "Must prove a one-off reaction never silently becomes a standing rule across future weeks.",
    blocking: false,
    escalation: null,
    rationale:
      "Observed once. Food OS records the reaction and waits — one bad night is not a preference.",
  },
  {
    feedbackId: "FB-DEMO-002",
    text: "We keep leaving the gem lettuce to go off. Please stop putting salad on Thursdays.",
    evidenceSource: "quick-stock-sweep:WASTED + tell-food-os:FREE_TEXT",
    actor: "Household",
    observedAt: "2026-02-10T18:40:00.000Z",
    occurrences: 4,
    attention: "DURABLE",
    affectedAreas: ["Meal planning", "Quantities", "Shopping basket", "Waste forecast"],
    propagation: "AWAITING_RUNTIME",
    consequence: {
      kind: "PREFERENCE",
      label: "Preference: no midweek leaf salad; buy leaves only when planned same-day",
      detail:
        "Would shape future meal selection and reduce recurring lettuce lines in the basket. Not created.",
    },
    regressionRequirement:
      "Must prove the preference changes future plans and basket quantities without rewriting past confirmed state.",
    blocking: false,
    escalation: null,
    rationale:
      "Repeated across four cycles with matching waste evidence — durable enough to shape planning, not urgent enough to block anything.",
  },
  {
    feedbackId: "FB-DEMO-003",
    text: "Sam has a diagnosed shellfish allergy. Nothing with shellfish, ever, including shared oils.",
    evidenceSource: "household-profile:SAFETY_REPORT",
    actor: "James",
    observedAt: "2026-02-10T19:05:00.000Z",
    occurrences: 1,
    attention: "CRITICAL",
    affectedAreas: [
      "Meal planning",
      "Recipe selection",
      "Shopping basket",
      "Substitutions",
      "Approval gate",
    ],
    propagation: "AWAITING_RUNTIME",
    consequence: {
      kind: "RULE",
      label: "Hard rule: exclude all shellfish and shellfish-contact products",
      detail:
        "Would block any plan, substitution or basket line that cannot be proven shellfish-free. Not created.",
    },
    regressionRequirement:
      "Must prove the constraint holds under substitution, unknown ingredients and partial product data — and fails closed when unproven.",
    blocking: true,
    escalation:
      "Escalated to the household operator: planning and basket approval stay blocked for affected items until this rule can be enforced and proven end-to-end.",
    rationale:
      "Safety-critical. A single report is enough — this class always fails closed rather than waiting for repetition.",
  },
] as const;

/** Nothing in this slice may claim propagation has happened. */
export function hasExecutedPropagation(cases: readonly FeedbackCase[]): boolean {
  return cases.some((c) => c.propagation === "PROVEN");
}

export function casesByAttention(cases: readonly FeedbackCase[]): FeedbackCase[] {
  return [...cases].sort(
    (a, b) => attentionMeta[b.attention].order - attentionMeta[a.attention].order,
  );
}

export const propagationLabel: Record<PropagationStatus, string> = {
  NOT_STARTED: "Not started",
  AWAITING_RUNTIME: "Awaiting runtime",
  PROVEN: "Proven",
};
