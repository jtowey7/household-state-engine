import type {
  ControlPlaneDirective,
  ControlPlaneSnapshot,
  DirectivePriority,
  WorkSelection,
} from "./types";

const PRIORITY_ORDER: Record<DirectivePriority, number> = { P0: 0, P1: 1, P2: 2 };

export interface SelectWorkOptions {
  /**
   * Directive IDs already satisfied in earlier wake-ups. The scheduler is
   * stateless, so this arrives from the control plane handoff, not memory.
   */
  completedDirectiveIds?: readonly string[];
}

/**
 * Deterministic work selection from control-plane state.
 *
 * Never hard-codes a task: it ranks by priority, then directive ID, and skips
 * anything blocked, done, dependency-incomplete or `Record class = Test`.
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
