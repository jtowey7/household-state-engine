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
 * One-time production baseline batches have a separate snapshot-scoped
 * authorization. The complete batch is fingerprinted and preflighted before
 * the first connector call; after that, individual appends remain idempotent,
 * so a connector failure can be safely resumed without replaying prior rows.
 */

import { hashOf } from "../state-engine/hash";
import { isCanonicalAppendRecord } from "./canonical";
import { AppendConflictError } from "./ports";
import type {
  AppendAuthorization,
  AppendReceipt,
  BatchAppendAuthorization,
  CanonicalAppendRecord,
  ProductionEventAppendPort,
  WriteOutcome,
  WriterMode,
  WriterRejection,
} from "./types";

export interface WriterConfig {
  mode?: WriterMode;
  port?: ProductionEventAppendPort;
}

export interface HouseholdEventWriter {
  readonly mode: WriterMode;
  propose(record: CanonicalAppendRecord): AppendReceipt;
  append(record: CanonicalAppendRecord, authorization?: AppendAuthorization): Promise<AppendReceipt>;
  /** One-time snapshot-scoped production baseline append. */
  appendBatch(
    records: readonly CanonicalAppendRecord[],
    authorization?: BatchAppendAuthorization,
  ): Promise<AppendReceipt[]>;
  receipts(): AppendReceipt[];
}

const ACCEPTED_EVIDENCE = new Set(["EXPLICIT_USER_INPUT", "STRONG_TRANSACTION_EVIDENCE"]);

/** Deterministic identity of the complete canonical batch. */
export function batchFingerprintFor(records: readonly CanonicalAppendRecord[]): string {
  return hashOf(
    [...records]
      .map((record) => ({ eventId: record.eventId, payloadHash: record.payloadHash }))
      .sort((a, b) =>
        `${a.eventId}\u0000${a.payloadHash}`.localeCompare(`${b.eventId}\u0000${b.payloadHash}`),
      ),
  );
}

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
      connector:
        usePort && port
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
    if (authorization.eventId !== record.eventId || authorization.payloadHash !== record.payloadHash) {
      return {
        code: "AUTHORIZATION_SCOPE_MISMATCH",
        detail:
          "The approval is bound to a different canonical event; an approval cannot be replayed onto another payload.",
      };
    }
    if (!ACCEPTED_EVIDENCE.has(authorization.evidenceSource)) {
      return {
        code: "INSUFFICIENT_EVIDENCE",
        detail: "Evidence must be explicit user input or strong transaction evidence, per the ACTION POLICY.",
      };
    }
    return null;
  }

  function checkProductionBoundary(record: CanonicalAppendRecord): WriterRejection | null {
    if (record.row["Record class"] !== "Production") {
      return {
        code: "TEST_RECORD_REFUSED",
        detail: "Record class = Test never enters production household state.",
      };
    }
    if (!port) {
      return { code: "NO_CONNECTOR", detail: "No append connector is supplied; nothing was written." };
    }
    if (mode !== "PRODUCTION_WRITE" && port.provenance === "PRODUCTION") {
      return {
        code: "PRODUCTION_WRITE_DISABLED",
        detail: "The writer is in PROPOSE mode; a production connector will not be called.",
      };
    }
    if (mode === "PRODUCTION_WRITE" && port.provenance !== "PRODUCTION") {
      return {
        code: "SYNTHETIC_PROVENANCE_REFUSED",
        detail: "A synthetic port cannot satisfy a production write; it may not claim production provenance.",
      };
    }
    return null;
  }

  async function appendCanonical(
    record: CanonicalAppendRecord,
    authorization: AppendAuthorization,
  ): Promise<AppendReceipt> {
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

    try {
      const ack = await port!.append(record);
      identity.set(record.eventId, record.payloadHash);
      return make(
        record,
        port!.provenance === "PRODUCTION" ? "APPENDED_PRODUCTION" : "APPENDED_SYNTHETIC",
        {
          authorization,
          includePort: true,
          written: true,
          connectorRecordId: ack.connectorRecordId,
        },
      );
    } catch (error) {
      if (error instanceof AppendConflictError) {
        return make(record, "REJECTED", {
          authorization,
          includePort: true,
          rejection: { code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT", detail: error.message },
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
            detail: "The writer accepts only canonical append records produced by canonicaliseAppend().",
          },
        });
      }

      const authFailure = checkAuthorization(record, authorization);
      if (authFailure) return make(record, "REJECTED", { rejection: authFailure, authorization });

      const boundaryFailure = checkProductionBoundary(record);
      if (boundaryFailure) return make(record, "REJECTED", { rejection: boundaryFailure, authorization, includePort: true });

      return appendCanonical(record, authorization!);
    },

    async appendBatch(records, authorization) {
      // Complete preflight happens before the first connector call. This is
      // critical: a malformed batch must not produce a partial production write.
      if (records.length === 0 || !authorization) {
        const rejection: WriterRejection = {
          code: "BATCH_AUTHORIZATION_INVALID",
          detail: "A non-empty canonical batch and explicit batch authorization are required.",
        };
        return [
          make(null, "REJECTED", { rejection }),
        ];
      }
      if (authorization.decision !== "APPROVED" || !ACCEPTED_EVIDENCE.has(authorization.evidenceSource)) {
        return [
          make(null, "REJECTED", {
            rejection: {
              code: "BATCH_AUTHORIZATION_INVALID",
              detail: "Batch authority must be APPROVED and rely on accepted evidence.",
            },
          }),
        ];
      }
      if (!authorization.snapshotId.trim() || authorization.eventCount !== records.length) {
        return [
          make(null, "REJECTED", {
            rejection: {
              code: "BATCH_AUTHORIZATION_SCOPE_MISMATCH",
              detail: "Batch snapshot ID and approved event count must exactly match the proposed batch.",
            },
          }),
        ];
      }
      if (!records.every(isCanonicalAppendRecord)) {
        return [
          make(null, "REJECTED", {
            rejection: {
              code: "BATCH_AUTHORIZATION_INVALID",
              detail: "Every batch member must be a canonical append record.",
            },
          }),
        ];
      }
      if (records.some((record) => record.row["Record class"] !== "Production")) {
        return [
          make(null, "REJECTED", {
            rejection: {
              code: "TEST_RECORD_REFUSED",
              detail: "A production baseline batch cannot contain Test-class records.",
            },
          }),
        ];
      }
      const ids = new Set<string>();
      for (const record of records) {
        if (ids.has(record.eventId)) {
          return [
            make(record, "REJECTED", {
              rejection: {
                code: "BATCH_AUTHORIZATION_INVALID",
                detail: `Batch contains Event ID ${record.eventId} more than once.`,
              },
            }),
          ];
        }
        ids.add(record.eventId);
      }

      const fingerprint = batchFingerprintFor(records);
      if (fingerprint !== authorization.batchFingerprint) {
        return [
          make(null, "REJECTED", {
            rejection: {
              code: "BATCH_AUTHORIZATION_SCOPE_MISMATCH",
              detail: "The approved batch fingerprint does not match the complete canonical batch.",
            },
          }),
        ];
      }

      const boundaryFailure = checkProductionBoundary(records[0]!);
      if (boundaryFailure) return [make(null, "REJECTED", { rejection: boundaryFailure, includePort: true })];

      // The snapshot-scoped approval is converted into ephemeral event-bound
      // approvals only inside this already-authorised batch. They cannot be
      // replayed outside the batch because the public API exposes only the
      // snapshot authorization and its fingerprint.
      const receipts: AppendReceipt[] = [];
      for (const record of records) {
        const eventAuthorization: AppendAuthorization = {
          authorizationId: `${authorization.authorizationId}:${record.eventId}`,
          decision: "APPROVED",
          approvedBy: authorization.approvedBy,
          approvedAt: authorization.approvedAt,
          evidenceSource: authorization.evidenceSource,
          evidenceDetail: authorization.evidenceDetail,
          eventId: record.eventId,
          payloadHash: record.payloadHash,
          actionPolicyReference: authorization.actionPolicyReference,
        };
        receipts.push(await appendCanonical(record, eventAuthorization));
      }
      return receipts;
    },

    receipts() {
      return log.map((r) => ({ ...r }));
    },
  };
}
