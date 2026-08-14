/**
 * Bounded authorization for the one-time Production HOUSEHOLD EVENTS baseline.
 *
 * The normal append gate deliberately requires one AppendAuthorization per
 * canonical event. The initial inventory baseline is approved as ONE exact
 * snapshot, so this seam safely expands that approval into per-event
 * authorizations without weakening the append gate.
 *
 * The approval is bound to:
 *   - the explicit ACTION POLICY action;
 *   - the exact baselineId/fingerprint;
 *   - the exact baseline timestamp and event count;
 *   - the exact set of Event IDs in the approved manifest.
 *
 * It never writes, never reads credentials, and never grants authority to
 * arbitrary household events or later household mutations.
 */

import type { CanonicalAppendRecord, AppendAuthorization } from "./types";

export const PRODUCTION_BASELINE_ACTION =
  "Initialise Production HOUSEHOLD EVENTS from current INVENTORY snapshot" as const;

export interface ProductionBaselineAuthorization {
  authorizationId: string;
  decision: "APPROVED";
  approvedBy: string;
  approvedAt: string;
  actionPolicyReference: typeof PRODUCTION_BASELINE_ACTION;
  baselineId: string;
  baselineTimestamp: string;
  source: "INVENTORY_SNAPSHOT";
  sourceRecordCount: number;
  eventIds: readonly string[];
  scope: "INITIAL_PRODUCTION_INVENTORY_BASELINE";
}

export type BaselineAuthorizationRefusalCode =
  | "BASELINE_AUTHORIZATION_REQUIRED"
  | "BASELINE_AUTHORIZATION_NOT_GRANTED"
  | "BASELINE_SCOPE_MISMATCH"
  | "BASELINE_EVENT_NOT_IN_MANIFEST";

export type BaselineAuthorizationResult =
  | { granted: true; authorization: AppendAuthorization }
  | {
      granted: false;
      refusal: {
        code: BaselineAuthorizationRefusalCode;
        detail: string;
      };
    };

export function authorizeProductionBaselineEvent(
  record: CanonicalAppendRecord,
  approval: ProductionBaselineAuthorization | null | undefined,
): BaselineAuthorizationResult {
  const refuse = (
    code: BaselineAuthorizationRefusalCode,
    detail: string,
  ): BaselineAuthorizationResult => ({ granted: false, refusal: { code, detail } });

  if (!approval) {
    return refuse(
      "BASELINE_AUTHORIZATION_REQUIRED",
      "The one-time Production baseline requires an explicit snapshot-scoped approval.",
    );
  }
  if (approval.decision !== "APPROVED") {
    return refuse(
      "BASELINE_AUTHORIZATION_NOT_GRANTED",
      "The Production baseline approval is not APPROVED.",
    );
  }
  if (approval.scope !== "INITIAL_PRODUCTION_INVENTORY_BASELINE") {
    return refuse(
      "BASELINE_SCOPE_MISMATCH",
      "The supplied approval is not scoped to the initial Production inventory baseline.",
    );
  }
  if (approval.actionPolicyReference !== PRODUCTION_BASELINE_ACTION) {
    return refuse(
      "BASELINE_SCOPE_MISMATCH",
      "The supplied approval does not reference the exact approved ACTION POLICY action.",
    );
  }
  if (approval.baselineTimestamp !== record.row["Occurred at"]) {
    return refuse(
      "BASELINE_SCOPE_MISMATCH",
      "The event occurred-at timestamp does not match the approved baseline timestamp.",
    );
  }
  if (record.row["Record class"] !== "Production") {
    return refuse(
      "BASELINE_SCOPE_MISMATCH",
      "Only Production-class events can enter the Production baseline approval scope.",
    );
  }
  if (!approval.eventIds.includes(record.eventId)) {
    return refuse(
      "BASELINE_EVENT_NOT_IN_MANIFEST",
      "This Event ID is not part of the exact approved baseline manifest.",
    );
  }

  return {
    granted: true,
    authorization: {
      authorizationId: `${approval.authorizationId}:${record.eventId}`,
      decision: "APPROVED",
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      evidenceSource: "EXPLICIT_USER_INPUT",
      evidenceDetail:
        `Production baseline approval ${approval.authorizationId}; baselineId=${approval.baselineId}; ` +
        `baselineTimestamp=${approval.baselineTimestamp}; source=${approval.source}; ` +
        `sourceRecordCount=${approval.sourceRecordCount}; eventId=${record.eventId}`,
      eventId: record.eventId,
      payloadHash: record.payloadHash,
      actionPolicyReference: approval.actionPolicyReference,
    },
  };
}
