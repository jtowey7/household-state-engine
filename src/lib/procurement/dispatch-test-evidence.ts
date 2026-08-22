import type { DispatchEvidence } from "./dispatch";

export function dispatchEvidence(totalCost: number, recordedAt = "2026-08-17T11:59:00.000Z"): DispatchEvidence {
  return {
    deliverySlot: {
      slotId: "SLOT-001",
      retailer: "synthetic-grocer",
      startsAt: "2026-08-17T18:00:00.000Z",
      endsAt: "2026-08-17T19:00:00.000Z",
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
