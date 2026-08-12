/**
 * Food OS — source → basket vertical-slice harness (ISOLATED SYNTHETIC EVIDENCE).
 *
 * Composes the EXISTING modules end-to-end, in order:
 *
 *   ProductionStatePort (memory / fake-Airtable-shaped, SYNTHETIC mode)
 *     -> loadProductionState()        (mode/provenance/ID-conflict/quarantine guards)
 *       -> replayEvents()             (State Engine, deterministic replay)
 *         -> toQuantityRequirementsHandoff()
 *           -> adaptSnapshotToQuantityRun()   (quantity requirements)
 *             -> aggregateCandidateBasket()   (existing procurement aggregation)
 *
 * It re-implements NO quantity or procurement maths: every stage is a call into
 * the module that already owns that contract. It never writes, never dispatches,
 * and is not connected to Airtable or to real household state.
 */

import { loadProductionState } from "../production-adapter/adapter";
import type { ProductionStatePort, LoadedProductionState, SourceScope } from "../production-adapter/types";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type { QuantityRequirementsHandoff, StateSnapshot } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import type { DemandTarget, QuantityRunPlan } from "../quantity-adapter/types";
import { aggregateCandidateBasket } from "../procurement/adapter";
import type { CandidateBasket, CatalogueEntry } from "../procurement/types";

export interface SliceOptions {
  port: ProductionStatePort;
  scope: SourceScope;
  /** Demand targets come from planning, never inferred from INVENTORY/events. */
  targets: readonly DemandTarget[];
  catalogue: readonly CatalogueEntry[];
  retailer?: string;
  now?: () => string;
  blockedItemPolicy?: "REFUSE_RUN" | "ISOLATE_ITEMS";
}

export interface SliceRun {
  loaded: LoadedProductionState;
  snapshot: StateSnapshot | null;
  handoff: QuantityRequirementsHandoff | null;
  plan: QuantityRunPlan;
  basket: CandidateBasket;
  /** Union of source event IDs surfaced into quantity requirements. */
  sourceEventIds: string[];
  /** This slice never dispatches procurement. */
  dispatched: false;
  /** Human approval is always still required downstream. */
  requiresHumanApproval: true;
}

export async function runSourceToBasketSlice(options: SliceOptions): Promise<SliceRun> {
  const loaded = await loadProductionState(options.port, options.scope);

  const finish = (
    snapshot: StateSnapshot | null,
    handoff: QuantityRequirementsHandoff | null,
    plan: QuantityRunPlan,
  ): SliceRun => ({
    loaded,
    snapshot,
    handoff,
    plan,
    basket: aggregateCandidateBasket(plan, {
      catalogue: options.catalogue,
      ...(options.retailer ? { retailer: options.retailer } : {}),
    }),
    sourceEventIds: [...new Set(plan.requirements.flatMap((r) => r.sourceEventIds))],
    dispatched: false,
    requiresHumanApproval: true,
  });

  if (!loaded.ok) {
    // A refused read must never fall back to static inventory: the adapter is
    // called with no snapshot so it emits its own fatal refusal.
    return finish(null, null, adaptSnapshotToQuantityRun(null, { targets: options.targets }));
  }

  const snapshot = replayEvents(loaded.openingEvents, options.now ? { now: options.now } : {});
  const handoff = toQuantityRequirementsHandoff(snapshot);
  const plan = adaptSnapshotToQuantityRun(handoff, {
    targets: options.targets,
    blockedItemPolicy: options.blockedItemPolicy ?? "REFUSE_RUN",
    // Source-level quarantine isolates the item downstream; it is never healed.
    isolatedItemKeys: loaded.quarantinedItemKeys,
  });
  return finish(snapshot, handoff, plan);
}
