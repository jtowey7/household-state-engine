import { hashOf } from "../state-engine/hash";
import type { HouseholdEvent } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type {
  LoadedProductionState,
  ProductionStatePort,
  SourceRejection,
  SourceScope,
} from "./types";

const SYNTHETIC_MARKERS = ["synthetic", "fixture", "test-lab", "demo"];

function looksSynthetic(text: string): boolean {
  const lower = text.toLowerCase();
  return SYNTHETIC_MARKERS.some((m) => lower.includes(m));
}

function failed(
  scope: SourceScope,
  portId: string,
  rejection: SourceRejection,
): LoadedProductionState {
  return {
    scope,
    portId,
    openingEvents: [],
    targets: [],
    quarantinedItemKeys: [],
    rejections: [rejection],
    ok: false,
    sourceId: hashOf({ scope, portId, rejection }),
    writable: false,
  };
}

/**
 * Reads household state through a port and applies the safety contract:
 *
 * - the port's mode must match the requested scope (no synthetic data may ever
 *   enter a PRODUCTION_READ_ONLY run, and production rows may not be smuggled
 *   into a synthetic run);
 * - immutable Event IDs stay unique: a reused ID with a different payload is
 *   rejected at the boundary rather than corrupting replay;
 * - structurally bad rows quarantine only their own item key, so uncertainty
 *   never blocks unrelated planning;
 * - the result is read-only — there is no write path back to household state.
 */
export async function loadProductionState(
  port: ProductionStatePort,
  scope: SourceScope,
): Promise<LoadedProductionState> {
  if (port.mode !== scope.mode) {
    return failed(scope, port.portId, {
      code: "MODE_MISMATCH",
      itemKey: null,
      eventId: null,
      detail: `Port mode "${port.mode}" does not match requested scope mode "${scope.mode}".`,
      fatal: true,
    });
  }

  let raw;
  try {
    raw = await port.read(scope);
  } catch (error) {
    return failed(scope, port.portId, {
      code: "SOURCE_UNAVAILABLE",
      itemKey: null,
      eventId: null,
      detail: `Source read failed: ${error instanceof Error ? error.message : String(error)}`,
      fatal: true,
    });
  }

  if (raw.claimedMode !== scope.mode) {
    return failed(scope, port.portId, {
      code: "MODE_MISMATCH",
      itemKey: null,
      eventId: null,
      detail: `Source returned mode "${raw.claimedMode}" for a "${scope.mode}" scope.`,
      fatal: true,
    });
  }

  const provenanceIsSynthetic = looksSynthetic(raw.provenance);
  if (scope.mode === "PRODUCTION_READ_ONLY" && provenanceIsSynthetic) {
    return failed(scope, port.portId, {
      code: "PROVENANCE_CONTAMINATION",
      itemKey: null,
      eventId: null,
      detail: `Synthetic provenance "${raw.provenance}" offered as production state; read refused.`,
      fatal: true,
    });
  }
  if (scope.mode === "SYNTHETIC" && !provenanceIsSynthetic) {
    return failed(scope, port.portId, {
      code: "PROVENANCE_CONTAMINATION",
      itemKey: null,
      eventId: null,
      detail: `Provenance "${raw.provenance}" is not marked synthetic; refusing to treat it as fixture data.`,
      fatal: true,
    });
  }

  const rejections: SourceRejection[] = [];
  const quarantined = new Set<string>();
  const openingEvents: HouseholdEvent[] = [];
  const seen = new Map<string, string>();

  for (const event of raw.openingEvents ?? []) {
    const itemKey = typeof event?.itemKey === "string" ? event.itemKey : null;
    if (!event?.eventId || !itemKey || !event.eventType || !event.occurredAt) {
      rejections.push({
        code: "MALFORMED_EVENT",
        itemKey,
        eventId: event?.eventId ?? null,
        detail: "Event is missing eventId/itemKey/eventType/occurredAt; row quarantined.",
        fatal: false,
      });
      if (itemKey) quarantined.add(itemKey);
      continue;
    }
    const identity = hashOf({
      recordClass: event.recordClass,
      eventType: event.eventType,
      itemKey: event.itemKey,
      occurredAt: event.occurredAt,
      payload: event.payload ?? {},
    });
    const known = seen.get(event.eventId);
    if (known !== undefined) {
      if (known !== identity) {
        rejections.push({
          code: "DUPLICATE_EVENT_ID",
          itemKey,
          eventId: event.eventId,
          detail: "Immutable Event ID reused with a different payload; item quarantined at source.",
          fatal: false,
        });
        quarantined.add(itemKey);
      }
      // Identical re-delivery: dropped here, and idempotent downstream anyway.
      continue;
    }
    seen.set(event.eventId, identity);
    openingEvents.push(event);
  }

  const targets: DemandTarget[] = [];
  for (const target of raw.targets ?? []) {
    if (!target?.itemKey || !target.unit) {
      rejections.push({
        code: "MALFORMED_TARGET",
        itemKey: target?.itemKey ?? null,
        eventId: null,
        detail: "Demand target is missing itemKey/unit; row quarantined.",
        fatal: false,
      });
      if (target?.itemKey) quarantined.add(target.itemKey);
      continue;
    }
    if (!Number.isFinite(target.targetQuantity) || target.targetQuantity <= 0) {
      rejections.push({
        code: "MALFORMED_TARGET",
        itemKey: target.itemKey,
        eventId: null,
        detail: `Demand target must be > 0, received ${target.targetQuantity}.`,
        fatal: false,
      });
      quarantined.add(target.itemKey);
      continue;
    }
    targets.push(target);
  }

  const quarantinedItemKeys = [...quarantined].sort();
  const keep = (key: string) => !quarantined.has(key);

  return {
    scope,
    portId: port.portId,
    openingEvents: openingEvents.filter((e) => keep(e.itemKey)),
    targets: targets.filter((t) => keep(t.itemKey)),
    quarantinedItemKeys,
    rejections,
    ok: true,
    sourceId: hashOf({
      scope,
      portId: port.portId,
      events: openingEvents.map((e) => e.eventId),
      targets: targets.map((t) => [t.itemKey, t.targetQuantity, t.unit]),
      quarantinedItemKeys,
    }),
    writable: false,
  };
}
