/**
 * Food OS — HUMAN DELIVERY / STOCK INPUT -> CANONICAL APPEND PROPOSAL (types).
 *
 * This seam owns no authority model and no connector. It routes an explicit
 * human input through the EXISTING sealed-evidence / correction-proposal paths
 * and returns the canonical HOUSEHOLD EVENTS records plus the exact approval
 * each record would require at the existing protected write boundary.
 */

import type { AppendReceipt, CanonicalAppendRecord, EvidenceSource } from "../event-writer/types";
import type { HumanDeliveryEvidence, HumanDeliveryEvidenceInput } from "../state-engine/delivery-evidence";
import type { UserReportedStockException } from "../inventory-exception/types";

export type HouseholdIntakeSubmission =
  | { kind: "DELIVERY"; input: HumanDeliveryEvidenceInput }
  | { kind: "STOCK_CORRECTION"; report: UserReportedStockException };

export interface DeliveryIntakeProvenance {
  kind: "DELIVERY";
  evidenceId: string;
  basketId: string;
  basketFingerprint: string;
  orderReference: string;
  retailer: string;
  deliveryId: string;
  dispatchId: string;
  capturedBy: string;
  capturedAt: string;
}

export interface StockCorrectionIntakeProvenance {
  kind: "STOCK_CORRECTION";
  exceptionId: string;
  itemKey: string;
  reportedBy: string;
  observedAt: string;
  reason: string;
}

export type HouseholdIntakeProvenance = DeliveryIntakeProvenance | StockCorrectionIntakeProvenance;

/**
 * The exact human authority the existing writer will demand for one canonical
 * record. It is a REQUEST, never an approval: it carries no decision and no
 * approver, so it can never satisfy the writer on its own.
 */
export interface IntakeApprovalRequest {
  eventId: string;
  payloadHash: string;
  item: string;
  eventType: string;
  summary: string;
  requiredEvidenceSource: EvidenceSource;
  actionPolicyReference: string;
}

export type HouseholdIntakeRejectionCode =
  | "INVALID_EVIDENCE"
  | "CANONICALISATION_FAILED"
  | "STOCK_INPUT_REFUSED";

export type HouseholdIntakePreparation =
  | {
      ok: true;
      kind: HouseholdIntakeSubmission["kind"];
      provenance: HouseholdIntakeProvenance;
      /** Sealed envelope, delivery submissions only. */
      evidence: HumanDeliveryEvidence | null;
      records: readonly CanonicalAppendRecord[];
      approvalRequests: readonly IntakeApprovalRequest[];
      receipts: readonly AppendReceipt[];
      proposed: number;
      readonly requiresHumanAuthorization: true;
      readonly productionMutation: false;
    }
  | { ok: false; code: HouseholdIntakeRejectionCode; detail: string };
