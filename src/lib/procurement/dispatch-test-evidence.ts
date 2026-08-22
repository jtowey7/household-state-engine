import type { DispatchEvidence } from "./dispatch";

export function dispatchEvidence(totalCost: number, recordedAt = "2026-08-17T11:59:00.000Z"): DispatchEvidence {
  const recorded = new Date(recordedAt);
  const startsAt = new Date(recorded.getTime() + 30 * 60 * 1000).toISOString();
  const endsAt = new Date(recorded.getTime() + 90 * 60 * 1000).toISOString();

  return {
    deliverySlot: {
      slotId: "SLOT-001",
      retailer: "synthetic-grocer",
      startsAt,
      endsAt,
      recordedAt,
    },
    substitutions: {
      decisionId: "SUB-001",
      outcome: "NONE",
      recordedAt,
    },
    spendPolicy: {
      decisionId: "SPEND-001",
      totalCost,
      outcome: "WITHIN_POLICY",
      recordedAt,
    },
  };
}
