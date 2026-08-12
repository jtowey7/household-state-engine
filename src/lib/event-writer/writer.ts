/**
 * The authorised HOUSEHOLD EVENTS writer.
 *
 * Gate order (each one refuses; none falls back to a weaker path):
 *   1. the record must be canonical (validated, identity-bearing)
 *   2. an explicit AppendAuthorization must exist and be APPROVED
 *   3. the approval must be bound to THIS Event ID and payload hash
 *   4. the evidence source must be one the ACTION POLICY accepts
 *   5. Test-class records never enter production household state
 *   6. PRODUCTION_WRITE requires a connector whose provenance is PRODUCTION
 *   7. a reused Event ID with a different payload is a hard conflict
 *
 * The writer only ever emits HOUSEHOLD EVENTS rows. It has no reference to
 * INVENTORY and no verb other than append, so consumption and correction can
 * only be expressed as new event records.
 */

import { hashOf } from "../state-engine/hash";
import { isCanonicalAppendRecord } from "./canonical";
import { AppendConflictError } from "./ports";
import type {
  AppendAuthorization,
  AppendReceipt,
  CanonicalAppendRecord,
  ProductionEventAppendPort,
  WriteOutcome,
  WriterMode,
  WriterRejection,
} from "./types";

export interface WriterConfig {
  /** Absent => PROPOSE. Production writes are opt-in and gated further. */
  mode?: WriterMode;
  /** The connector. A synthetic port can never satisfy PRODUCTION_WRITE. */
  port?: ProductionEventAppendPort;
}

export interface HouseholdEventWriter {
  readonly mode: WriterMode;
  /**
   * Prepares a record for human review. Structurally incapable of writing:
   * it never touches the port.
   */
  propose(record: CanonicalAppendRecord): AppendReceipt;
  /** The single append operation. */
  append(
    record: CanonicalAppendRecord,
    authorization?: AppendAuthorization,
  ): Promise<AppendReceipt>;
  /** Receipts in order, for observability. */
  receipts(): AppendReceipt[];
}

const ACCEPTED_EVIDENCE = new Set(["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"]);

function receiptId(parts: {
  eventId: string;
  payloadHash: string;
  outcome: WriteOutcome;
  portId: string | null;
  authorizationId: string | null;
}): string {
  return `RCPT-${hashOf(parts).slice(0, 16)}`;
}

export function createHouseholdEventWriter(config: WriterConfig = {}): HouseholdEventWriter {
  const mode: WriterMode = config.mode ?? "PROPOSE";
  const port = config.port ?? null;
  // Event ID -> payload hash of the record already accepted under that ID.
  const identity = new Map<string, string>();
  const log: AppendReceipt[] = [];

  function make(
    record: CanonicalAppendRecord | null,
    outcome: WriteOutcome,
    options: {
      rejection?: WriterRejection | undefined;
      authorization?: AppendAuthorization | undefined;
      connectorRecordId?: string | undefined;
      written?: boolean | undefined;
      includePort?: boolean | undefined;
    } = {},
  ): AppendReceipt {
    const usePort = options.includePort ?? false;
    const receipt: AppendReceipt = {
      receiptId: receiptId({
        eventId: record?.eventId ?? "",
        payloadHash: record?.payloadHash ?? "",
        outcome,
        portId: usePort ? (port?.portId ?? null) : null,
        authorizationId: options.authorization?.authorizationId ?? null,
      }),
      eventId: record?.eventId ?? "",
      payloadHash: record?.payloadHash ?? "",
      outcome,
      written: options.written ?? false,
      connector: usePort && port
        ? {
            portId: port.portId,
            provenance: port.provenance,
            connectorRecordId: options.connectorRecordId ?? null,
          }
        : null,
      authorization: options.authorization
        ? {
            authorizationId: options.authorization.authorizationId,
            approvedBy: options.authorization.approvedBy,
            evidenceSource: options.authorization.evidenceSource,
            actionPolicyReference: options.authorization.actionPolicyReference,
          }
        : null,
      table: "HOUSEHOLD EVENTS",
      inventoryMutated: false,
      rejection: options.rejection ?? null,
    };
    log.push(receipt);
    return receipt;
  }

  function checkAuthorization(
    record: CanonicalAppendRecord,
    authorization: AppendAuthorization | undefined,
  ): WriterRejection | null {
    if (!authorization) {
      return {
        code: "AUTHORIZATION_REQUIRED",
        detail:
          "ACTION POLICY: recording a consumption event is PREPARE, never auto-execute. An explicit approval object is required.",
      };
    }
    if (authorization.decision !== "APPROVED") {
      return {
        code: "AUTHORIZATION_NOT_GRANTED",
        detail: `Authorization ${authorization.authorizationId} is ${authorization.decision}; no write is performed.`,
      };
    }
    if (
      authorization.eventId !== record.eventId ||
      authorization.payloadHash !== record.payloadHash
    ) {
      return {
        code: "AUTHORIZATION_SCOPE_MISMATCH",
        detail:
          "The approval is bound to a different canonical event; an approval cannot be replayed onto another payload.",
      };
    }
    if (!ACCEPTED_EVIDENCE.has(authorization.evidenceSource)) {
      return {
        code: "INSUFFICIENT_EVIDENCE",
        detail:
          "Evidence must be explicit user input or strong transaction evidence, per the ACTION POLICY.",
      };
    }
    return null;
  }

  return {
    mode,

    propose(record) {
      if (!isCanonicalAppendRecord(record)) {
        return make(null, "REJECTED", {
          rejection: { code: "NOT_CANONICAL", detail: "Not a canonical append record." },
        });
      }
      return make(record, "PROPOSED");
    },

    async append(record, authorization) {
      if (!isCanonicalAppendRecord(record)) {
        return make(null, "REJECTED", {
          rejection: {
            code: "NOT_CANONICAL",
            detail:
              "The writer accepts only canonical append records produced by canonicaliseAppend().",
          },
        });
      }

      const authFailure = checkAuthorization(record, authorization);
      if (authFailure) return make(record, "REJECTED", { rejection: authFailure, authorization });

      if (record.row["Record class"] !== "Production") {
        return make(record, "REJECTED", {
          authorization,
          rejection: {
            code: "TEST_RECORD_REFUSED",
            detail: "Record class = Test never enters production household state.",
          },
        });
      }

      // Identity: same ID + same payload is a no-op; same ID + different
      // payload is a hard conflict. Neither performs a second write.
      const known = identity.get(record.eventId);
      if (known !== undefined) {
        if (known === record.payloadHash) {
          return make(record, "DUPLICATE_NOOP", { authorization, includePort: true });
        }
        return make(record, "REJECTED", {
          authorization,
          rejection: {
            code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT",
            detail: `Event ID ${record.eventId} already carries a different canonical payload; existing records are never mutated.`,
          },
        });
      }

      if (!port) {
        return make(record, "REJECTED", {
          authorization,
          rejection: {
            code: "NO_CONNECTOR",
            detail: "No append connector is supplied; nothing was written.",
          },
        });
      }

      if (mode !== "PRODUCTION_WRITE" && port.provenance === "PRODUCTION") {
        return make(record, "REJECTED", {
          authorization,
          includePort: true,
          rejection: {
            code: "PRODUCTION_WRITE_DISABLED",
            detail: "The writer is in PROPOSE mode; a production connector will not be called.",
          },
        });
      }

      if (mode === "PRODUCTION_WRITE" && port.provenance !== "PRODUCTION") {
        return make(record, "REJECTED", {
          authorization,
          includePort: true,
          rejection: {
            code: "SYNTHETIC_PROVENANCE_REFUSED",
            detail:
              "A synthetic port cannot satisfy a production write; it may not claim production provenance.",
          },
        });
      }

      let ack;
      try {
        ack = await port.append(record);
      } catch (error) {
        if (error instanceof AppendConflictError) {
          return make(record, "REJECTED", {
            authorization,
            includePort: true,
            rejection: {
              code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT",
              detail: error.message,
            },
          });
        }
        return make(record, "REJECTED", {
          authorization,
          includePort: true,
          rejection: {
            code: "CONNECTOR_FAILED",
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      }

      identity.set(record.eventId, record.payloadHash);
      return make(
        record,
        port.provenance === "PRODUCTION" ? "APPENDED_PRODUCTION" : "APPENDED_SYNTHETIC",
        {
          authorization,
          includePort: true,
          written: true,
          connectorRecordId: ack.connectorRecordId,
        },
      );
    },

    receipts() {
      return log.map((r) => ({ ...r }));
    },
  };
}
