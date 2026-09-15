/**
 * Fail-closed validation for generated meal candidates.
 *
 * A candidate that cannot be described exactly is refused, never repaired and
 * never guessed. Refusal reasons are plain household sentences.
 */

import { normaliseHouseholdUnit } from "../inventory-exception/unit-contract";
import type { MealCandidate, MealGenerationRequest } from "./types";

export interface CandidateRefusal {
  candidateId: string | null;
  reason: string;
}

export type CandidateValidation =
  | { ok: true; candidates: MealCandidate[] }
  | { ok: false; refusals: CandidateRefusal[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CANDIDATES = 7;

function dayOffset(weekStartIso: string, plannedFor: string): number | null {
  const start = Date.parse(`${weekStartIso}T00:00:00.000Z`);
  const day = Date.parse(`${plannedFor}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(day)) return null;
  const diff = (day - start) / 86_400_000;
  return Number.isInteger(diff) ? diff : null;
}

export function validateMealCandidates(
  candidates: readonly MealCandidate[],
  request: MealGenerationRequest,
): CandidateValidation {
  const refusals: CandidateRefusal[] = [];
  const seenIds = new Set<string>();
  const seenDays = new Set<string>();

  if (candidates.length === 0) {
    return { ok: false, refusals: [{ candidateId: null, reason: "No meals were suggested for this week." }] };
  }
  if (candidates.length > MAX_CANDIDATES) {
    refusals.push({ candidateId: null, reason: "A week can hold at most seven meals." });
  }
  if (!ISO_DATE.test(request.weekStartIso)) {
    return { ok: false, refusals: [{ candidateId: null, reason: "The week being planned is not clear." }] };
  }

  for (const candidate of candidates) {
    const id = typeof candidate.candidateId === "string" ? candidate.candidateId.trim() : "";
    if (!id) {
      refusals.push({ candidateId: null, reason: "A suggested meal is missing its identity." });
      continue;
    }
    if (seenIds.has(id)) {
      refusals.push({ candidateId: id, reason: "The same meal was suggested twice." });
      continue;
    }
    seenIds.add(id);

    if (!candidate.label || !candidate.label.trim()) {
      refusals.push({ candidateId: id, reason: "A suggested meal has no name." });
      continue;
    }
    if (!ISO_DATE.test(candidate.plannedFor)) {
      refusals.push({ candidateId: id, reason: `${candidate.label} has no clear day.` });
      continue;
    }
    const offset = dayOffset(request.weekStartIso, candidate.plannedFor);
    if (offset === null || offset < 0 || offset > 6) {
      refusals.push({ candidateId: id, reason: `${candidate.label} is not in this week.` });
      continue;
    }
    if (seenDays.has(candidate.plannedFor)) {
      refusals.push({ candidateId: id, reason: `There is already a meal on that day.` });
      continue;
    }
    seenDays.add(candidate.plannedFor);

    if (!candidate.components || candidate.components.length === 0) {
      refusals.push({ candidateId: id, reason: `${candidate.label} does not say what it needs.` });
      continue;
    }
    let componentProblem: string | null = null;
    for (const component of candidate.components) {
      if (!component.itemKey || !component.itemKey.trim()) {
        componentProblem = `${candidate.label} lists something without a name.`;
        break;
      }
      if (typeof component.quantity !== "number" || !Number.isFinite(component.quantity) || component.quantity <= 0) {
        componentProblem = `${candidate.label} has an amount FoodOS cannot read.`;
        break;
      }
      if (!normaliseHouseholdUnit(component.unit)) {
        componentProblem = `${candidate.label} uses a measure FoodOS does not recognise.`;
        break;
      }
    }
    if (componentProblem) refusals.push({ candidateId: id, reason: componentProblem });
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, candidates: [...candidates] };
}
