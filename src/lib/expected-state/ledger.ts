import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import { hashOf } from "../state-engine/hash";
import type { HouseholdEvent } from "../state-engine/types";
import type {
  ConsumptionEvidence,
  ExpectedConsumption,
  ForecastItem,
  ForecastItemStatus,
  ReconcileInput,
  ReconcileOptions,
  ReconciliationEntry,
  ReconciliationRun,
} from "./types";

const isProduction = (rc?: string) => rc !== "Test";

function evidenceIdentity(e: ConsumptionEvidence): string {
  return hashOf({
    itemKey: e.itemKey,
    expectationId: e.expectationId ?? null,
    observedQuantity: e.observedQuantity ?? null,
    unit: e.unit ?? null,
    observedAt: e.observedAt,
    confidence: e.confidence ?? null,
  });
}

/** Evidence must be attributable and quantified before it can confirm state. */
function isSufficient(e: ConsumptionEvidence): boolean {
  const q = e.observedQuantity;
  if (typeof q !== "number" || !Number.isFinite(q) || q < 0) return false;
  if (!e.unit) return false;
  if (e.confidence !== "OBSERVED" && e.confidence !== "REPORTED") return false;
  return true;
}

/**
 * Reconciles planned (expected) consumption against evidence-producing
 * household interactions.
 *
 * Guarantees:
 * - expected events and confirmed events are replayed into SEPARATE snapshots;
 *   planning can never masquerade as observed truth;
 * - evidence never mutates state directly: it is reconciled first, and only
 *   sufficient evidence produces a confirmed household event;
 * - disagreement is surfaced as an explicit entry and isolates the item — it is
 *   never averaged, preferred or silently resolved;
 * - duplicate evidence delivery is idempotent; a reused evidence id carrying a
 *   different payload is a conflict and blocks the item.
 */
export function reconcileExpectedWithConfirmed(
  input: ReconcileInput,
  options: ReconcileOptions,
): ReconciliationRun {
  const tolerance = options.tolerance ?? 0;
  const opening = [...(input.openingEvents ?? [])];

  const expectations = (input.expectations ?? []).filter((x) => isProduction(x.recordClass));
  const entries: ReconciliationEntry[] = [];
  const blocked = new Set<string>();

  // --- evidence intake: dedupe by immutable id, detect payload conflicts -----
  const firstSeen = new Map<string, string>();
  const accepted: ConsumptionEvidence[] = [];
  const conflicted = new Set<string>();
  for (const ev of input.evidence ?? []) {
    if (!isProduction(ev.recordClass)) continue; // Record class = Test: zero effect
    const identity = evidenceIdentity(ev);
    const known = firstSeen.get(ev.evidenceId);
    if (known === identity) continue; // identical duplicate delivery — idempotent
    if (known !== undefined) {
      conflicted.add(ev.evidenceId);
      blocked.add(ev.itemKey);
      entries.push({
        status: "EVIDENCE_PAYLOAD_CONFLICT",
        itemKey: ev.itemKey,
        expectationId: ev.expectationId ?? null,
        evidenceIds: [ev.evidenceId],
        expectedQuantity: null,
        confirmedQuantity: null,
        unit: ev.unit ?? null,
        delta: null,
        blocking: true,
        detail:
          "Evidence id reused with a different canonical payload; no second mutation applied.",
      });
      continue;
    }
    firstSeen.set(ev.evidenceId, identity);
    accepted.push(ev);
  }

  const byExpectation = new Map<string, ConsumptionEvidence[]>();
  const unmatched: ConsumptionEvidence[] = [];
  for (const ev of accepted) {
    if (ev.expectationId) {
      const list = byExpectation.get(ev.expectationId) ?? [];
      list.push(ev);
      byExpectation.set(ev.expectationId, list);
    } else {
      unmatched.push(ev);
    }
  }

  // --- expected (planning) events -------------------------------------------
  const expectedEvents: HouseholdEvent[] = [...opening];
  for (const x of expectations) {
    if (x.expectedAt > options.asOf) continue;
    if (x.quantity <= 0) continue;
    expectedEvents.push({
      eventId: `EXPECTED:${x.expectationId}`,
      recordClass: "Production",
      eventType: "ITEM_STOCK_DELTA",
      itemKey: x.itemKey,
      occurredAt: x.expectedAt,
      payload: { quantity: -x.quantity, unit: x.unit, note: `expected via ${x.sourceId}` },
    });
  }

  // --- confirmed (evidence) events ------------------------------------------
  const confirmedEvents: HouseholdEvent[] = [...opening];
  const emitConfirmed = (ev: ConsumptionEvidence) => {
    confirmedEvents.push({
      eventId: `CONFIRMED:${ev.evidenceId}`,
      recordClass: "Production",
      eventType: "ITEM_STOCK_DELTA",
      itemKey: ev.itemKey,
      occurredAt: ev.observedAt,
      payload: {
        quantity: -(ev.observedQuantity ?? 0),
        unit: ev.unit!,
        note: `confirmed by ${ev.actor ?? "unknown actor"} (${ev.source ?? "unknown source"})`,
      },
    });
  };

  for (const x of expectations) {
    const evs = byExpectation.get(x.expectationId) ?? [];
    if (evs.length === 0) {
      const due = x.expectedAt <= options.asOf;
      entries.push({
        status: due ? "AWAITING_EVIDENCE" : "NOT_DUE",
        itemKey: x.itemKey,
        expectationId: x.expectationId,
        evidenceIds: [],
        expectedQuantity: x.quantity,
        confirmedQuantity: null,
        unit: x.unit,
        delta: null,
        blocking: false,
        detail: due
          ? "Expected consumption is due but unconfirmed; expected and confirmed state differ."
          : "Expectation is not due yet; nothing burned in either view.",
      });
      continue;
    }

    const usable = evs.filter((e) => isSufficient(e));
    const insufficient = evs.filter((e) => !isSufficient(e));
    for (const e of insufficient) {
      blocked.add(x.itemKey);
      entries.push({
        status: "EVIDENCE_INSUFFICIENT",
        itemKey: x.itemKey,
        expectationId: x.expectationId,
        evidenceIds: [e.evidenceId],
        expectedQuantity: x.quantity,
        confirmedQuantity: null,
        unit: x.unit,
        delta: null,
        blocking: true,
        detail:
          "Evidence lacks a usable quantity, unit or confidence; state stays unconfirmed and the item is isolated.",
      });
    }
    if (usable.length === 0) continue;

    const badUnit = usable.filter((e) => e.unit !== x.unit);
    if (badUnit.length > 0) {
      blocked.add(x.itemKey);
      entries.push({
        status: "UNIT_CONFLICT",
        itemKey: x.itemKey,
        expectationId: x.expectationId,
        evidenceIds: badUnit.map((e) => e.evidenceId),
        expectedQuantity: x.quantity,
        confirmedQuantity: null,
        unit: x.unit,
        delta: null,
        blocking: true,
        detail: `Evidence unit is incomparable with the expected unit "${x.unit}"; no confirmation applied.`,
      });
      continue;
    }

    const confirmedQuantity = usable.reduce((s, e) => s + (e.observedQuantity ?? 0), 0);
    for (const e of usable) emitConfirmed(e);
    const delta = confirmedQuantity - x.quantity;
    const matched = Math.abs(delta) <= tolerance;
    if (!matched) blocked.add(x.itemKey);
    entries.push({
      status: matched ? "MATCHED" : "DIVERGED",
      itemKey: x.itemKey,
      expectationId: x.expectationId,
      evidenceIds: usable.map((e) => e.evidenceId),
      expectedQuantity: x.quantity,
      confirmedQuantity,
      unit: x.unit,
      delta,
      blocking: !matched,
      detail: matched
        ? "Evidence agrees with the expectation within tolerance."
        : `Confirmed ${confirmedQuantity}${x.unit} against an expected ${x.quantity}${x.unit}; disagreement kept explicit and the item isolated.`,
    });
  }

  for (const e of unmatched) {
    if (!isSufficient(e)) {
      blocked.add(e.itemKey);
      entries.push({
        status: "EVIDENCE_INSUFFICIENT",
        itemKey: e.itemKey,
        expectationId: null,
        evidenceIds: [e.evidenceId],
        expectedQuantity: null,
        confirmedQuantity: null,
        unit: e.unit ?? null,
        delta: null,
        blocking: true,
        detail: "Unplanned interaction produced insufficient evidence; item isolated.",
      });
      continue;
    }
    emitConfirmed(e);
    entries.push({
      status: "UNEXPECTED_CONFIRMED",
      itemKey: e.itemKey,
      expectationId: null,
      evidenceIds: [e.evidenceId],
      expectedQuantity: null,
      confirmedQuantity: e.observedQuantity ?? 0,
      unit: e.unit ?? null,
      delta: null,
      blocking: false,
      detail: "Confirmed consumption with no matching expectation; recorded as an exception.",
    });
  }

  const replayOpts = options.now ? { now: options.now } : {};
  const expectedSnapshot = replayEvents(expectedEvents, replayOpts);
  const confirmedSnapshot = replayEvents(confirmedEvents, replayOpts);

  for (const key of expectedSnapshot.blockedItemKeys) blocked.add(key);
  for (const key of confirmedSnapshot.blockedItemKeys) blocked.add(key);

  const awaiting = new Set(
    entries.filter((e) => e.status === "AWAITING_EVIDENCE").map((e) => e.itemKey),
  );
  const itemKeys = [
    ...new Set([
      ...expectedSnapshot.items.map((i) => i.itemKey),
      ...confirmedSnapshot.items.map((i) => i.itemKey),
    ]),
  ].sort();

  const forecast: ForecastItem[] = itemKeys.map((itemKey) => {
    const exp = expectedSnapshot.items.find((i) => i.itemKey === itemKey);
    const con = confirmedSnapshot.items.find((i) => i.itemKey === itemKey);
    const expectedRemaining = exp?.quantity ?? 0;
    const confirmedRemaining = con?.quantity ?? 0;
    const divergence = expectedRemaining - confirmedRemaining;
    const status: ForecastItemStatus = blocked.has(itemKey)
      ? "BLOCKED"
      : divergence === 0
        ? "AGREED"
        : awaiting.has(itemKey)
          ? "AWAITING_CONFIRMATION"
          : "DIVERGED";
    return {
      itemKey,
      expectedRemaining,
      confirmedRemaining,
      divergence,
      unit: con?.unit ?? exp?.unit ?? null,
      status,
    };
  });

  const hasBlocking = entries.some((e) => e.blocking) || blocked.size > 0;
  const reconciliationStatus = hasBlocking
    ? ("BLOCKED" as const)
    : entries.some((e) => e.status !== "MATCHED" && e.status !== "NOT_DUE")
      ? ("EXCEPTIONS" as const)
      : ("CLEAN" as const);

  const base = toQuantityRequirementsHandoff(confirmedSnapshot);
  const handoff = {
    ...base,
    reconciliationStatus,
    readyForQuantityRun: reconciliationStatus !== "BLOCKED",
    items: base.items.filter((i) => !blocked.has(i.itemKey)),
    blockedItemKeys: [...new Set([...base.blockedItemKeys, ...blocked])].sort(),
  };

  return {
    expectedEvents,
    confirmedEvents,
    expectedSnapshot,
    confirmedSnapshot,
    entries,
    forecast,
    blockedItemKeys: [...blocked].sort(),
    reconciliationStatus,
    handoff,
  };
}
