/**
 * Deterministic urgency for stateless scheduler selection.
 *
 * The scheduler must not infer urgency from the existence of a schedule entry.
 * A directive is urgent only when an explicit dueAt is present and the current
 * wake time is evaluated against it.
 */

export type TemporalUrgency =
  | "NORMAL"
  | "TIME-SENSITIVE"
  | "DEADLINE"
  | "OVERDUE"
  | "MISSED";

export const DEFAULT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TemporalUrgencyInput {
  dueAt?: string;
  wakeAt: string;
  /** Time after dueAt during which an overdue directive remains recoverable. */
  recoveryWindowMs?: number;
}

export interface TemporalUrgencyResult {
  state: TemporalUrgency;
  dueAt: string | null;
  remainingMs: number | null;
}

export function classifyTemporalUrgency(
  input: TemporalUrgencyInput,
): TemporalUrgencyResult {
  if (!input.dueAt) {
    return { state: "NORMAL", dueAt: null, remainingMs: null };
  }

  const wake = Date.parse(input.wakeAt);
  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(wake) || !Number.isFinite(due)) {
    throw new Error("Temporal urgency requires valid ISO timestamps.");
  }

  const remainingMs = due - wake;
  if (remainingMs > 24 * 60 * 60 * 1000) {
    return { state: "NORMAL", dueAt: input.dueAt, remainingMs };
  }
  if (remainingMs > 2 * 60 * 60 * 1000) {
    return { state: "TIME-SENSITIVE", dueAt: input.dueAt, remainingMs };
  }
  if (remainingMs > 0) {
    return { state: "DEADLINE", dueAt: input.dueAt, remainingMs };
  }

  const recoveryWindowMs = input.recoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
  if (recoveryWindowMs < 0) {
    throw new Error("Temporal urgency recovery window must not be negative.");
  }

  return {
    state: Math.abs(remainingMs) <= recoveryWindowMs ? "OVERDUE" : "MISSED",
    dueAt: input.dueAt,
    remainingMs,
  };
}
