import type { FeedbackReport } from "./types";

/** SYNTHETIC feedback reports — illustration and tests only. */

export const oneOffReport: FeedbackReport = {
  feedbackId: "FB-SYNTH-001",
  recordClass: "Production",
  subject: "miso-butter-greens",
  text: "Didn't love the miso butter greens on Monday — a bit rich for a weeknight.",
  actor: "James",
  evidenceSource: "tell-food-os:FREE_TEXT",
  observedAt: "2026-02-09T20:10:00.000Z",
  polarity: "AVOID",
};

export const durableReports: FeedbackReport[] = [
  {
    feedbackId: "FB-SYNTH-010",
    recordClass: "Production",
    subject: "leaf-salad",
    text: "Gem lettuce went off again.",
    actor: "Household",
    evidenceSource: "quick-stock-sweep:WASTED",
    observedAt: "2026-02-03T18:40:00.000Z",
    evidenceRefs: ["EVT-WASTE-0001"],
    polarity: "AVOID",
  },
  {
    feedbackId: "FB-SYNTH-011",
    recordClass: "Production",
    subject: "leaf-salad",
    text: "Threw the salad out untouched.",
    actor: "Household",
    evidenceSource: "quick-stock-sweep:WASTED",
    observedAt: "2026-02-06T18:40:00.000Z",
    evidenceRefs: ["EVT-WASTE-0002"],
    polarity: "AVOID",
  },
  {
    feedbackId: "FB-SYNTH-012",
    recordClass: "Production",
    subject: "leaf-salad",
    text: "Please stop putting salad on Thursdays.",
    actor: "James",
    evidenceSource: "tell-food-os:FREE_TEXT",
    observedAt: "2026-02-10T18:40:00.000Z",
    evidenceRefs: ["EVT-WASTE-0003"],
    polarity: "AVOID",
  },
];

export const safetyReport: FeedbackReport = {
  feedbackId: "FB-SYNTH-020",
  recordClass: "Production",
  subject: "shellfish",
  text: "Sam has a diagnosed shellfish allergy. Nothing with shellfish, ever.",
  actor: "James",
  evidenceSource: "household-profile:SAFETY_REPORT",
  observedAt: "2026-02-10T19:05:00.000Z",
  evidenceRefs: ["PROFILE-SAM-ALLERGY"],
  safetyConstraint: true,
  polarity: "AVOID",
};

/** Same subject, contradicting direction — evidence is ambiguous. */
export const ambiguousReports: FeedbackReport[] = [
  {
    feedbackId: "FB-SYNTH-030",
    recordClass: "Production",
    subject: "haribo",
    text: "Stop buying Haribo.",
    actor: "James",
    evidenceSource: "tell-food-os:FREE_TEXT",
    observedAt: "2026-02-08T09:00:00.000Z",
    evidenceRefs: ["EVT-STOCK-0100"],
    polarity: "AVOID",
  },
  {
    feedbackId: "FB-SYNTH-031",
    recordClass: "Production",
    subject: "haribo",
    text: "Keep the Haribo, the kids want it.",
    actor: "Household",
    evidenceSource: "tell-food-os:FREE_TEXT",
    observedAt: "2026-02-09T09:00:00.000Z",
    evidenceRefs: ["EVT-STOCK-0101"],
    polarity: "PREFER",
  },
];

export const testClassReport: FeedbackReport = {
  feedbackId: "FB-SYNTH-999",
  recordClass: "Test",
  subject: "shellfish",
  text: "Synthetic smoke feedback (test class).",
  actor: "harness",
  evidenceSource: "test-lab:SYNTHETIC",
  observedAt: "2026-02-10T19:05:00.000Z",
  safetyConstraint: true,
};
