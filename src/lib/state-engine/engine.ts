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

  // Canonical replay identity: Test records and identical duplicate deliveries
  // contribute nothing. A reused Event ID carrying a *different* canonical
  // payload is a real conflict and DOES change identity.
  const canonicalIdentity: { eventId: string; identity: string }[] = [];
  const seenIdentity = new Map<string, string>();
  for (const e of events) {
    if (e.recordClass === "Test") continue;
    const identity = eventIdentity(e);
    const first = seenIdentity.get(e.eventId);
    if (first === identity) continue; // identical duplicate delivery
    if (first === undefined) seenIdentity.set(e.eventId, identity);
    canonicalIdentity.push({ eventId: e.eventId, identity });
  }
  const replayId = hashOf(canonicalIdentity);

  const exceptions: ReconciliationException[] = [];
  const contributingEventIds: string[] = [];
  const ignoredEventIds: string[] = [];
  // Ignore entries that DO affect canonical snapshot identity (real conflicts).
  const canonicalIgnoredEventIds: string[] = [];
  const items = new Map<string, ItemState>();
  const blockedItems = new Set<string>();

  // Identity of the first authoritative occurrence of each Event ID.
  const identities = new Map<string, string>();
  // Pre-pass: supersession set derived from first authoritative occurrences only.
  // Test records are outside production event identity and therefore cannot claim
  // an Event ID or suppress supersession metadata from a later Production event.
  const superseded = new Set<string>();
  const firstSeen = new Set<string>();
  const supersedesEdges = new Map<string, string[]>();
  for (const e of events) {
    if (e.recordClass === "Test") continue;
    if (firstSeen.has(e.eventId)) continue;
    firstSeen.add(e.eventId);
    const targets = [...(e.supersedes ?? [])];
    supersedesEdges.set(e.eventId, targets);
    for (const id of targets) superseded.add(id);
  }

  // Supersession must resolve to a winner. A cycle (including self-supersession)
  // has no winner: naively skipping every member silently annihilates all
  // evidence for the affected items and leaves the run non-blocking. Detect
  // cycle members up front so they become an explicit blocking conflict.
  const supersessionCycleIds = new Set<string>();
  {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = new Map<string, number>();
    const visit = (id: string, stack: string[]): void => {
      const state = colour.get(id) ?? WHITE;
      if (state === GREY) {
        // Everything from the first occurrence of `id` on the stack is a cycle.
        for (let i = stack.lastIndexOf(id); i >= 0 && i < stack.length; i++) {
          supersessionCycleIds.add(stack[i]!);
        }
        return;
      }
      if (state === BLACK) return;
      colour.set(id, GREY);
      stack.push(id);
      for (const next of supersedesEdges.get(id) ?? []) visit(next, stack);
      stack.pop();
      colour.set(id, BLACK);
    };
    for (const id of supersedesEdges.keys()) visit(id, []);
  }


  const ensureItem = (itemKey: string): ItemState => {
    let item = items.get(itemKey);
    if (!item) {
      item = {
        itemKey,
        quantity: 0,
        unit: null,
        removed: false,
        evidencePrecision: "EXACT",
        lastAppliedEventId: null,
        contributingEventIds: [],
        blocked: false,
      };
      items.set(itemKey, item);
    }
    return item;
  };

  for (const e of events) {
    // Test fixtures are outside production event identity entirely. This must
    // happen before Event-ID deduplication so a synthetic fixture cannot claim
    // an Event ID and accidentally suppress a later production event.
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

    const identity = eventIdentity(e);
    const known = identities.get(e.eventId);

    if (known !== undefined) {
      ignoredEventIds.push(e.eventId);
      if (known === identity) {
        // Identical duplicate delivery — idempotent, no second mutation and no
        // effect on canonical replay/snapshot identity (audit exception only).
        exceptions.push({
          code: "DUPLICATE_EVENT_IGNORED",
          eventId: e.eventId,
          itemKey: e.itemKey,
          detail: "Identical duplicate delivery ignored (idempotent).",
          blocking: false,
        });
      } else {
        // Reused Event ID with different canonical payload — integrity conflict.
        canonicalIgnoredEventIds.push(e.eventId);
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

    if (supersessionCycleIds.has(e.eventId)) {
      ignoredEventIds.push(e.eventId);
      canonicalIgnoredEventIds.push(e.eventId);
      exceptions.push({
        code: "SUPERSESSION_CYCLE_BLOCKED",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail:
          "Supersession forms a cycle with no resolvable winner; no mutation applied and the item is isolated pending explicit reconciliation.",
        blocking: true,
      });
      blockedItems.add(e.itemKey);
      continue;
    }

    if (superseded.has(e.eventId)) {
      ignoredEventIds.push(e.eventId);
      canonicalIgnoredEventIds.push(e.eventId);
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

    // A delta expressed in a unit incomparable with the item's current unit
    // would silently corrupt on-hand (e.g. -1 "kg" added to 780 "g").
    if (
      e.eventType === "ITEM_STOCK_DELTA" &&
      e.payload.unit !== undefined &&
      item.unit !== null &&
      e.payload.unit !== item.unit
    ) {
      ignoredEventIds.push(e.eventId);
      canonicalIgnoredEventIds.push(e.eventId);
      exceptions.push({
        code: "UNIT_CONFLICT_BLOCKED",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail: `Delta unit "${e.payload.unit}" is incomparable with the item's unit "${item.unit}"; no mutation applied.`,
        blocking: true,
      });
      blockedItems.add(e.itemKey);
      continue;
    }

    switch (e.eventType) {
      case "ITEM_STOCK_SET":
        item.quantity = e.payload.quantity ?? 0;
        item.unit = e.payload.unit ?? item.unit;
        item.evidencePrecision = e.payload.evidencePrecision ?? "EXACT";
        item.removed = false;
        break;
      case "ITEM_STOCK_DELTA":
        item.quantity += e.payload.quantity ?? 0;
        item.unit = e.payload.unit ?? item.unit;
        if (e.payload.evidencePrecision === "QUALIFIED_AMBIGUOUS") {
          item.evidencePrecision = "QUALIFIED_AMBIGUOUS";
        }
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

    // Qualified source evidence is explicitly unsuitable for automatic
    // quantity/procurement decisions until reconciled. Preserve the precision
    // on the item and block only that item from the downstream handoff.
    if (item.evidencePrecision === "QUALIFIED_AMBIGUOUS") {
      exceptions.push({
        code: "QUALIFIED_AMBIGUOUS_EVIDENCE",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail: "Source quantity evidence is qualified/ambiguous; explicit reconciliation is required before downstream quantity/procurement use.",
        blocking: true,
      });
      blockedItems.add(e.itemKey);
    }

    // Negative on-hand means the static picture was stale or consumption was
    // under-reported. Isolate the item (never procured on a guess) but keep
    // the run non-blocking so unrelated planning continues.
    if (item.quantity < 0 && !blockedItems.has(item.itemKey)) {
      exceptions.push({
        code: "NEGATIVE_STOCK_ISOLATED",
        eventId: e.eventId,
        itemKey: e.itemKey,
        detail: `Replay drove on-hand to ${item.quantity}; item isolated from the quantity run, provenance kept.`,
        blocking: false,
      });
      blockedItems.add(item.itemKey);
    }
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

  // Snapshot identity is canonical: audit-only exceptions (identical duplicate
  // deliveries, excluded Test records) and their ignored-id entries do not
  // change it. Real conflicts (reused id, unit, supersession, qualified
  // evidence) still do.
  const nonCanonical = new Set(["DUPLICATE_EVENT_IGNORED", "TEST_RECORD_EXCLUDED"]);
  const canonicalExceptions = exceptions.filter((x) => !nonCanonical.has(x.code));

  // Materialised-state status. Evidence-only exceptions must not flip it, or a
  // re-delivered duplicate would change downstream plan/basket identity while
  // the materialised state is byte-identical.
  const canonicalReconciliationStatus: ReconciliationStatus = canonicalExceptions.some((x) => x.blocking)
    ? "BLOCKED"
    : canonicalExceptions.length > 0
      ? "EXCEPTIONS"
      : "CLEAN";
  const snapshotId = hashOf({
    replayId,
    items: orderedItems,
    contributingEventIds,
    ignoredEventIds: canonicalIgnoredEventIds,
    exceptions: canonicalExceptions,
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
    canonicalReconciliationStatus,
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
    canonicalReconciliationStatus:
      snapshot.canonicalReconciliationStatus ?? snapshot.reconciliationStatus,
    readyForQuantityRun: snapshot.reconciliationStatus !== "BLOCKED",
    items: snapshot.items
      .filter((i) => !i.blocked && !i.removed)
      .map((i) => ({
        itemKey: i.itemKey,
        quantity: i.quantity,
        unit: i.unit,
        evidencePrecision: i.evidencePrecision,
        sourceEventIds: [...i.contributingEventIds],
      })),
    blockedItemKeys: [...snapshot.blockedItemKeys],
  };
}
