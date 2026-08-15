import type { EvidencePrecision } from "./types";

/**
 * Classify source quantity evidence without changing the numeric quantity.
 * Numeric stock is not treated as exact merely because it is numeric.
 * Qualifying language makes the value unsuitable for automatic downstream
 * quantity/procurement decisions until explicitly reconciled.
 */
export function classifyEvidencePrecision(notes?: string | null): EvidencePrecision {
  const text = (notes ?? "").trim().toLowerCase();
  if (!text) return "EXACT";

  const qualifierPatterns = [
    /\bapprox\b/,
    /\bapproximate(?:ly)?\b/,
    /\bestimated?\b/,
    /\bpartial(?:ly)?\b/,
    /\btrace\b/,
    /\bsmall amount\b/,
    /\ba few\b/,
    /\bused\b/,
    /\bunknown\b/,
    /\buncertain\b/,
    /\broughly\b/,
    /\babout\b/,
    /\bhalf(?:\s+used)?\b/,
    /\bopened\b/,
  ];

  return qualifierPatterns.some((pattern) => pattern.test(text))
    ? "QUALIFIED_AMBIGUOUS"
    : "EXACT";
}
