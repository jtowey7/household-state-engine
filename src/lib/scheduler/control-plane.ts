import type {
  ControlPlaneDirective,
  ControlPlaneSnapshot,
  DirectivePriority,
  WorkSelection,
} from "./types";
import { classifyTemporalUrgency, type TemporalUrgency } from "./temporal-urgency";

const PRIORITY_ORDER: Record<DirectivePriority, number> = { P0: 0, P1: 1, P2: 2 };
const TEMPORAL_ORDER: Record<TemporalUrgency, number> = {
  DEADLINE: 0,
  OVERDUE: 1,
  "TIME-SENSITIVE": 2,
  NORMAL: 3,
  MISSED: 4,
};

export interface SelectWorkOptions {
  /**
   * Directive IDs already satisfied in earlier wake-ups. The scheduler is
   * stateless, so this arrives from the control plane handoff, not memory.
   */
  completedDirectiveIds?: readonly string[];
  /** Wake timestamp used for deterministic temporal urgency. */
  wakeAt?: string;
}

function temporalRank(directive: ControlPlaneDirective, wakeAt?: string): number {
  if (!wakeAt || directive.actionPolicy !== "PREPARE" || !directive.dueAt) {
    return TEMPORAL_ORDER.NORMAL;
  }
  const urgency = classifyTemporalUrgency({
    dueAt: directive.dueAt,
    wakeAt,
    recoveryWindowMs: directive.recoveryWindowMs,
  });
  return TEMPORAL_ORDER[urgency.state];
}

/**
 * Deterministic work selection from control-plane state.
 *
 * Never hard-codes a task: it ranks eligible production directives by
 * consequential temporal urgency first, then static priority, then directive
 * ID. Urgency can only outrank static priority for READY, dependency-satisfied
 * PREPARE work; blocked, DONE, Test and unsupported execution are never
 * promoted by a deadline.
 */
export function selectWork(
  snapshot: ControlPlaneSnapshot,
  options: SelectWorkOptions = {},
): WorkSelection {
  const done = new Set(options.completedDirectiveIds ?? []);
  for (const d of snapshot.directives) if (d.status === "DONE") done.add(d.directiveId);

  const considered = [...snapshot.directives]
    .filter((d) => (d.recordClass ?? "Production") === "Production")
    .sort((a, b) =>
      temporalRank(a, options.wakeAt) - temporalRank(b, options.wakeAt) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.directiveId < b.directiveId ? -1 : a.directiveId > b.directiveId ? 1 : 0),
    );
  const consideredIds = considered.map((d) => d.directiveId);
  const blocked: { directiveId: string; reason: string }[] = [];

  if (snapshot.mode !== "SYNTHETIC") {
    return {
      selected: false,
      refusal: {
        code: "NOT_PRODUCTION_MODE",
        detail: "Only SYNTHETIC control-plane snapshots may be executed in this workspace.",
      },
      consideredIds,
      blocked,
    };
  }

  if (considered.length === 0) {
    return {
      selected: false,
      refusal: { code: "NO_DIRECTIVES", detail: "Control plane holds no executable directive." },
      consideredIds,
      blocked,
    };
  }

  let sawOpen = false;
  for (const directive of considered) {
    if (done.has(directive.directiveId)) continue;
    sawOpen = true;
    if (directive.status === "BLOCKED") {
      blocked.push({
        directiveId: directive.directiveId,
        reason: directive.blockedReason ?? "Marked BLOCKED in the control plane.",
      });
      continue;
    }
    const unmet = (directive.dependsOn ?? []).filter((id) => !done.has(id));
    if (unmet.length > 0) {
      blocked.push({
        directiveId: directive.directiveId,
        reason: `Waiting on ${unmet.join(", ")}.`,
      });
      continue;
    }
    return { selected: true, directive, consideredIds };
  }

  return {
    selected: false,
    refusal: sawOpen
      ? { code: "ALL_BLOCKED", detail: "Every open directive is blocked or dependency-gated." }
      : { code: "ALL_DONE", detail: "Every control-plane directive is already DONE." },
    consideredIds,
    blocked,
  };
}

export function directiveById(
  snapshot: ControlPlaneSnapshot,
  directiveId: string,
): ControlPlaneDirective | null {
  return snapshot.directives.find((d) => d.directiveId === directiveId) ?? null;
}
