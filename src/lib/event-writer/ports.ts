/**
 * Connector-agnostic ports for the append seam.
 *
 * `FakeAppendPort` is a synthetic test double. It reports
 * `provenance: "SYNTHETIC"` and there is no option, flag, or constructor
 * argument that lets it claim production — the writer refuses it for
 * production writes on that basis alone.
 *
 * The real Airtable connector is implemented by the evidence-aware REST
 * transport in `airtable-rest-append.ts`. This factory is the canonical
 * production construction seam; it refuses to construct unless the approved
 * runtime supplies both the Food OS base and an Airtable credential.
 */

import type {
  AirtableAppendPort,
  CanonicalAppendRecord,
  PortAppendAck,
  ProductionEventAppendPort,
} from "./types";
import { createAirtableRestAppendPort } from "./airtable-rest-append";
import type { FetchLike } from "../production-adapter/airtable-rest-source";

/** Raised by an append port when one Event ID is reused for a new payload. */
export class AppendConflictError extends Error {
  readonly code = "REUSED_EVENT_ID_PAYLOAD_CONFLICT";
  constructor(
    readonly eventId: string,
    readonly existingPayloadHash: string,
    readonly incomingPayloadHash: string,
  ) {
    super(
      `Event ID ${eventId} already carries payload ${existingPayloadHash}; the ledger is append-only and never re-points an Event ID at ${incomingPayloadHash}.`,
    );
    this.name = "AppendConflictError";
  }
}

export interface LedgerEntry {
  eventId: string;
  payloadHash: string;
  connectorRecordId: string;
  record: CanonicalAppendRecord;
}

export interface FakeAppendPort extends ProductionEventAppendPort {
  readonly provenance: "SYNTHETIC";
  /** Rows this double accepted, in order. Test inspection only. */
  readonly appended: CanonicalAppendRecord[];
  /** Append-only ledger. There is no verb that removes or edits an entry. */
  ledger(): readonly LedgerEntry[];
}

/**
 * Synthetic append-only ledger. It stores HOUSEHOLD EVENTS rows only and has
 * no INVENTORY surface at all, so it cannot mutate inventory even in tests.
 * Same Event ID + same payload is idempotent (no second ledger entry); same
 * Event ID + different payload is a hard conflict.
 */
export function createFakeAppendPort(options: { portId?: string; failWith?: string } = {}): FakeAppendPort {
  const appended: CanonicalAppendRecord[] = [];
  const entries: LedgerEntry[] = [];
  const byEventId = new Map<string, LedgerEntry>();
  return {
    portId: options.portId ?? "fake-append-port",
    provenance: "SYNTHETIC",
    appended,
    ledger: () => entries.map((e) => ({ ...e })),
    async append(record) {
      if (options.failWith) throw new Error(options.failWith);
      const existing = byEventId.get(record.eventId);
      if (existing) {
        if (existing.payloadHash !== record.payloadHash) {
          throw new AppendConflictError(record.eventId, existing.payloadHash, record.payloadHash);
        }
        return {
          connectorRecordId: existing.connectorRecordId,
          acknowledgedAt: existing.record.row["Recorded at"],
          duplicate: true,
        } satisfies PortAppendAck;
      }
      appended.push(record);
      const entry: LedgerEntry = {
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        connectorRecordId: `synthetic-${entries.length + 1}`,
        record,
      };
      entries.push(entry);
      byEventId.set(record.eventId, entry);
      return {
        connectorRecordId: entry.connectorRecordId,
        acknowledgedAt: record.row["Recorded at"],
      } satisfies PortAppendAck;
    },
  };
}

export interface AirtableAppendPortConfig {
  baseId: string;
  /** Personal access token / connector credential supplied by the approved runtime. */
  credential: string;
  /** Optional HTTP implementation for deterministic tests or an approved runtime. */
  fetchImpl?: FetchLike;
  /** Existing Event ID → payload-hash ledger from the same snapshot. */
  existing?: Map<string, string | null>;
}

export type AirtableAppendPortResult =
  | { ok: true; port: AirtableAppendPort }
  | { ok: false; reason: "CONNECTOR_ABSENT"; detail: string };

/**
 * Canonical production connector factory.
 *
 * The real append implementation lives in `airtable-rest-append.ts`; this
 * factory is the single production construction seam used by the writer.
 * Nothing is defaulted or inferred, and missing credentials fail closed.
 */
export function createAirtableAppendPort(
  config: Partial<AirtableAppendPortConfig> = {},
): AirtableAppendPortResult {
  const missing = (["baseId", "credential"] as const).filter((key) => !config[key]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "CONNECTOR_ABSENT",
      detail: `No Airtable append connector can be constructed; missing ${missing.join(", ")}. The production write gate remains fail-closed.`,
    };
  }

  return {
    ok: true,
    port: createAirtableRestAppendPort({
      baseId: config.baseId as string,
      apiKey: config.credential as string,
      fetchImpl: config.fetchImpl,
      existing: config.existing,
    }),
  };
}
