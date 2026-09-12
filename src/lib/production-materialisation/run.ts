/**
 * End-to-end Production materialisation run:
 * load (read-only) -> replay (existing engine) -> plan -> execute.
 *
 * No HOUSEHOLD EVENTS row is created or edited by this path; only INVENTORY is
 * materialised and `Replay status` flipped after a fully successful write.
 */

import { loadProductionState } from "../production-adapter/adapter";
import type { ProductionStatePort, SourceScope } from "../production-adapter/types";
import { replayEvents } from "../state-engine/engine";
import { executeInventoryMaterialisation } from "./execute";
import { planInventoryMaterialisation } from "./plan";
import type { MaterialisationApproval, MaterialisationExecution, MaterialisationPlan, MaterialisationPort, MaterialisationRefusalCode } from "./types";

export type MaterialisationRunResult =
  | { ok: false; stage: "LOAD" | "PLAN"; code: MaterialisationRefusalCode; detail: string }
  | { ok: false; stage: "EXECUTE"; execution: Extract<MaterialisationExecution, { ok: false }>; plan: MaterialisationPlan }
  | { ok: true; plan: MaterialisationPlan; execution: Extract<MaterialisationExecution, { ok: true }> };

export async function runProductionMaterialisation(input: {
  readPort: ProductionStatePort;
  writePort: MaterialisationPort;
  scope: SourceScope;
  replayClock: string;
  approval: MaterialisationApproval;
}): Promise<MaterialisationRunResult> {
  const loaded = await loadProductionState(input.readPort, input.scope);
  if (!loaded.ok) {
    return {
      ok: false,
      stage: "LOAD",
      code: "SOURCE_LOAD_FAILED",
      detail: loaded.rejections.map((rejection) => `${rejection.code}: ${rejection.detail}`).join("; ") || "Read failed.",
    };
  }

  const snapshot = replayEvents(loaded.openingEvents, { now: () => input.replayClock });
  const existingInventory = await input.writePort.listInventory();
  const decision = planInventoryMaterialisation({ loaded, snapshot, existingInventory, approval: input.approval });
  if (!decision.ok) {
    return { ok: false, stage: "PLAN", code: decision.code, detail: decision.detail };
  }

  const execution = await executeInventoryMaterialisation(decision, input.writePort);
  if (!execution.ok) return { ok: false, stage: "EXECUTE", execution, plan: decision };
  return { ok: true, plan: decision, execution };
}
