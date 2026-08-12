import { replayEvents } from "../state-engine/engine";
import type { HouseholdEvent } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "./adapter";
import type { DemandTarget, QuantityRunPlan } from "./types";

export interface ShadowRunResult {
  snapshotId: string;
  replayId: string;
  reconciliationStatus: string;
  plan: QuantityRunPlan;
  /** Shadow runs never dispatch procurement — they only report eligibility. */
  dispatched: false;
}

/**
 * Shadow-run harness: replays a SYNTHETIC event stream and adapts it into a
 * quantity run plan without dispatching anything downstream.
 */
export function shadowRun(
  events: readonly HouseholdEvent[],
  targets: readonly DemandTarget[],
  options: { now?: () => string } = {},
): ShadowRunResult {
  const snapshot = replayEvents(events, options);
  const plan = adaptSnapshotToQuantityRun(snapshot, { targets });
  return {
    snapshotId: snapshot.snapshotId,
    replayId: snapshot.replayId,
    reconciliationStatus: snapshot.reconciliationStatus,
    plan,
    dispatched: false,
  };
}
