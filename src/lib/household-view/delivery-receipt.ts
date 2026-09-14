/**
 * FoodOS — read-only detection of an ALREADY-APPLIED delivery receipt.
 *
 * PURE + FAIL-CLOSED. This module never writes, never proposes, and never
 * infers arrival from an approved shop or an approved delivery. A receipt is
 * only recognised when canonical HOUSEHOLD EVENTS rows prove all of:
 *
 *   - `Record class` is Production (Test rows can never prove a receipt);
 *   - `Replay status` is exactly `Applied`;
 *   - the row's sealed `Evidence` payload records the SAME basket identity —
 *     basketId AND basketVersion AND basketFingerprint — as the basket being
 *     shown to the household.
 *
 * Anything less (unparsable evidence, a different basket version, a pending
 * replay status) yields "no receipt", so the household keeps the explicit
 * human confirmation journey.
 */

export interface DeliveryBasketIdentity {
  basketId: string;
  basketVersion: number;
  basketFingerprint: string;
}

/** Minimal projection of a canonical HOUSEHOLD EVENTS row. */
export interface DeliveryEventRow {
  eventId: string | null;
  recordClass: string | null;
  replayStatus: string | null;
  occurredAt: string | null;
  /** The sealed Evidence JSON string exactly as stored. */
  evidence: string | null;
}

export type DeliveryReceiptDetection =
  | {
      confirmed: true;
      deliveryId: string;
      deliveredAt: string | null;
      appliedEventIds: string[];
    }
  | { confirmed: false; reason: "NO_MATCHING_APPLIED_DELIVERY" };

const NOT_CONFIRMED: DeliveryReceiptDetection = {
  confirmed: false,
  reason: "NO_MATCHING_APPLIED_DELIVERY",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function evidenceMatches(raw: string, identity: DeliveryBasketIdentity): { deliveryId: string } | null {
  // The canonical writer appends " | approval:<ref>" after the sealed JSON.
  const jsonPart = raw.split(" | approval:")[0]?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const payload = parsed as Record<string, unknown>;
  if (text(payload['basketId']) !== identity.basketId.trim()) return null;
  if (payload['basketVersion'] !== identity.basketVersion) return null;
  if (text(payload['basketFingerprint']) !== identity.basketFingerprint.trim()) return null;
  const deliveryId = text(payload['deliveryId']);
  if (!deliveryId) return null;
  return { deliveryId };
}

export function detectAppliedDeliveryReceipt(
  rows: readonly DeliveryEventRow[],
  identity: DeliveryBasketIdentity,
): DeliveryReceiptDetection {
  if (!identity.basketId.trim() || !identity.basketFingerprint.trim()) return NOT_CONFIRMED;
  if (!Number.isInteger(identity.basketVersion) || identity.basketVersion < 1) return NOT_CONFIRMED;

  const matched: { eventId: string; deliveryId: string; occurredAt: string | null }[] = [];
  for (const row of rows) {
    if (text(row.recordClass) !== "Production") continue;
    if (text(row.replayStatus) !== "Applied") continue;
    const evidence = text(row.evidence);
    if (!evidence) continue;
    const match = evidenceMatches(evidence, identity);
    if (!match) continue;
    const eventId = text(row.eventId);
    if (!eventId) continue;
    matched.push({ eventId, deliveryId: match.deliveryId, occurredAt: text(row.occurredAt) });
  }

  if (matched.length === 0) return NOT_CONFIRMED;

  // More than one distinct delivery for the same exact basket identity is
  // ambiguous evidence, so it is refused rather than guessed at.
  const deliveryIds = [...new Set(matched.map((row) => row.deliveryId))];
  if (deliveryIds.length !== 1) return NOT_CONFIRMED;

  const appliedEventIds = [...new Set(matched.map((row) => row.eventId))].sort((a, b) =>
    a.localeCompare(b),
  );
  const deliveredAt = matched
    .map((row) => row.occurredAt)
    .filter((value): value is string => typeof value === "string")
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;

  return { confirmed: true, deliveryId: deliveryIds[0]!, deliveredAt, appliedEventIds };
}
