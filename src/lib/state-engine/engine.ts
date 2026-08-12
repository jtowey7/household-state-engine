import type {
  HouseholdEvent,
  ItemState,
  QuantityRequirementsHandoff,
  ReconciliationException,
  ReconciliationStatus,
  StateSnapshot,
} from "./types";
import { hashOf } from "./hash";

export interface ReplayOptions {
  /** Injectable clock so replays remain byte-for-byte deterministic in tests. */
  now?: () => string;
}

/** Canonical identity of an event payload — used for reused-ID conflict detection. */
function eventIdentity(e: HouseholdEvent): string {
  return hashOf({
    recordClass: e.recordClass,
    eventType: e.eventType,
    itemKey: e.itemKey,
    occurredAt: e.occurredAt,
    payload: e.payload ?? {},
    supersedes: [...(e.supersedes ?? [])].sort(),
  });
}

export function replayEvents(
  events: readonly HouseholdEvent[],
  options: ReplayOptions = {},
): StateSnapshot {
  const replayTimestamp = options.now ? options.now() : new Date().toISOString();
  const replayId = hashOf(
    events.map((e) => ({ eventId: e.eventId, identity: eventIdentity(e) })),
  );

  const exceptions: ReconciliationException[] = [];
  const contributingEventIds: string[] = [];
  const ignoredEventIds: string[] = [];
  const items = new Map<string, ItemState>();
  const blockedItems = new Set<string>();

  // Identity of the first authoritative occurrence of each Event ID.
  const identities = new Map<string, string>();
  // Pre-pass: supersession set derived from first occurrences only.
  const superseded = new Set<string>();
  const firstSeen = new Set<string>();
  for (const e of events) {
    if (firstSeen.has(e.eventId)) continue;
    firstSeen.add(e.eventId);
    if (e.recordClass === "Test") continue;
    for (const id of e.supersedes ?? []) superseded.add(id);
  }

  const ensureItem = (itemKey: string): ItemState => {
    let item = items.get(itemKey);
    if (!item) {
      item = {
        itemKey,
        quantity: 0,
        unit: null,
        removed: false,
        lastAppliedEventId: null,
        contributingEventIds: [],
        blocked: false,
      };
      items.set(itemKey, item);
    }
    return item;
  };

  for (const e of events) {
    const identity = eventIdentity(e);
    const known = identities.get(e.eventId);

    if (known !== undefined) {
      ignoredEventIds.push(e.eventId);
      if (known === identity) {
        // Identical duplicate delivery — idempotent, no second mutation.
        exceptions.push({
          code: "DUPLICATE_EVENT_IGNORED",
          eventId: e.eventId,
          itemKey: e.itemKey,
          detail: "Identical duplicate delivery ignored (idempotent).",
          blocking: false,
        });
      } else {
        // Reused Event ID with different canonical payload — integrity conflict.
        exceptions.push({
          code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT",
          eventId: e.eventId,
          itemKey: e.itemKey,
          detail:
            "Event ID reused with a different canonical payload; no second mutation applied.",
          blocking: true,
        });
        blockedItems.add(e.itemKey);
        const original = events.find(
          (o) => o.eventId === e.eventId && eventIdentity(o) === known,
        );
        if (original) blockedItems.add(original.itemKey);
      }
      continue;
    }

    identities.set(e.eventId, identity);

    if (e.recordClass === "Test") {
      ignoredEventIds.push(e.eventId);
      exceptions.push({
        code: "TEST_RECORD_EXCLUDED",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail: "Record class = Test has zero effect on materialised state.",
        blocking: false,
      });
      continue;
    }

    if (superseded.has(e.eventId)) {
      ignoredEventIds.push(e.eventId);
      exceptions.push({
        code: "SUPERSEDED_EVENT_NOT_APPLIED",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail: "Event superseded by a later event; not applied.",
        blocking: false,
      });
      continue;
    }

    const item = ensureItem(e.itemKey);
    switch (e.eventType) {
      case "ITEM_STOCK_SET":
        item.quantity = e.payload.quantity ?? 0;
        item.unit = e.payload.unit ?? item.unit;
        item.removed = false;
        break;
      case "ITEM_STOCK_DELTA":
        item.quantity += e.payload.quantity ?? 0;
        item.unit = e.payload.unit ?? item.unit;
        item.removed = false;
        break;
      case "ITEM_REMOVED":
        item.quantity = 0;
        item.removed = true;
        break;
    }
    item.lastAppliedEventId = e.eventId;
    item.contributingEventIds.push(e.eventId);
    contributingEventIds.push(e.eventId);
  }

  for (const item of items.values()) item.blocked = blockedItems.has(item.itemKey);
  // A conflict may reference an item with no applied events yet.
  for (const key of blockedItems) ensureItem(key).blocked = true;

  const orderedItems = [...items.values()].sort((a, b) =>
    a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0,
  );

  const hasBlocking = exceptions.some((x) => x.blocking);
  const reconciliationStatus: ReconciliationStatus = hasBlocking
    ? "BLOCKED"
    : exceptions.length > 0
      ? "EXCEPTIONS"
      : "CLEAN";

  const snapshotId = hashOf({
    replayId,
    items: orderedItems,
    contributingEventIds,
    ignoredEventIds,
    exceptions,
    reconciliationStatus,
  });

  return {
    snapshotId,
    replayId,
    replayTimestamp,
    items: orderedItems,
    contributingEventIds,
    ignoredEventIds,
    exceptions,
    reconciliationStatus,
    blockedItemKeys: [...blockedItems].sort(),
  };
}

/** Shapes a snapshot for the existing QUANTITY REQUIREMENTS handoff. */
export function toQuantityRequirementsHandoff(
  snapshot: StateSnapshot,
): QuantityRequirementsHandoff {
  return {
    replayId: snapshot.replayId,
    snapshotId: snapshot.snapshotId,
    replayTimestamp: snapshot.replayTimestamp,
    reconciliationStatus: snapshot.reconciliationStatus,
    readyForQuantityRun: snapshot.reconciliationStatus !== "BLOCKED",
    items: snapshot.items
      .filter((i) => !i.blocked && !i.removed)
      .map((i) => ({
        itemKey: i.itemKey,
        quantity: i.quantity,
        unit: i.unit,
        sourceEventIds: [...i.contributingEventIds],
      })),
    blockedItemKeys: [...snapshot.blockedItemKeys],
  };
}
