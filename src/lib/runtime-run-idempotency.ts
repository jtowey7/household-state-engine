export type RuntimeRunReplay = {
  taskId: string;
  agentId: string;
  outcome: string;
  evidence: string;
};

export type RuntimeRunReplayValidation =
  | { valid: true }
  | { valid: false; reason: "Run identity conflict" | "Run payload conflict" };

export function validateRuntimeRunReplay(
  existing: RuntimeRunReplay,
  incoming: RuntimeRunReplay,
): RuntimeRunReplayValidation {
  if (existing.taskId !== incoming.taskId || existing.agentId !== incoming.agentId) {
    return { valid: false, reason: "Run identity conflict" };
  }
  if (existing.outcome !== incoming.outcome || existing.evidence !== incoming.evidence) {
    return { valid: false, reason: "Run payload conflict" };
  }
  return { valid: true };
}
