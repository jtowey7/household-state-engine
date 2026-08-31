import { replayEvents, toQuantityRequirementsHandoff } from "./engine";
import { buildDeliveryInventoryTransition, type ReconciledDelivery } from "./delivery-inventory";
import type { QuantityRequirementsHandoff, StateSnapshot } from "./types";

export interface DeliveryInventoryMaterialisation {
  transitionId: string;
  snapshot: StateSnapshot;
  quantityHandoff: QuantityRequirementsHandoff;
}

/**
 * Joins the already-reconciled delivery transition to the canonical household
 * state materialisation path. This remains a pure function: it performs no
 * Airtable or Production writes. Callers decide separately whether/how the
 * resulting events are persisted.
 */
export function materialiseReconciledDelivery(
  delivery: ReconciledDelivery,
  now?: () => string,
): DeliveryInventoryMaterialisation {
  const transition = buildDeliveryInventoryTransition(delivery);
  const snapshot = replayEvents(transition.events, { now });
  const quantityHandoff = toQuantityRequirementsHandoff(snapshot);

  return {
    transitionId: transition.transitionId,
    snapshot,
    quantityHandoff,
  };
}
