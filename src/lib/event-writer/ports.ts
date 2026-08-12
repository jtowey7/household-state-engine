/**
 * Connector-agnostic ports for the append seam.
 *
 * `FakeAppendPort` is a synthetic test double. It reports
 * `provenance: "SYNTHETIC"` and there is no option, flag, or constructor
 * argument that lets it claim production — the writer refuses it for
 * production writes on that basis alone.
 *
 * The real Airtable connector is intentionally ABSENT. This workspace has no
 * Airtable connection and no credentials, so `createAirtableAppendPort`
 * refuses to construct rather than shipping a stand-in that behaves like a
 * connector in tests and fails in reality.
 */

import type {
  AirtableAppendPort,
  CanonicalAppendRecord,
  PortAppendAck,
  ProductionEventAppendPort,
} from "./types";

/** Raised by the fake port when one Event ID is reused for a new payload. */
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
        // Idempotent redelivery: acknowledged, but no second ledger entry.
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
  /** Personal access token / connector credential. Absent in this workspace. */
  credential: string;
  /** Supplied by an approved runtime; there is no default HTTP client. */
  transport: (record: CanonicalAppendRecord) => Promise<PortAppendAck>;
}

export type AirtableAppendPortResult =
  | { ok: true; port: AirtableAppendPort }
  | { ok: false; reason: "CONNECTOR_ABSENT"; detail: string };

/**
 * Would construct the real production connector. Every argument must be
 * supplied by an approved runtime; nothing is defaulted or inferred, so in a
 * workspace with no Airtable connection this always refuses.
 */
export function createAirtableAppendPort(
  config: Partial<AirtableAppendPortConfig> = {},
): AirtableAppendPortResult {
  const missing = (["baseId", "credential", "transport"] as const).filter((k) => !config[k]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "CONNECTOR_ABSENT",
      detail: `No Airtable append connector exists in this workspace; missing ${missing.join(", ")}. The contract is defined but deliberately unimplemented.`,
    };
  }
  const { baseId, transport } = config as AirtableAppendPortConfig;
  return {
    ok: true,
    port: {
      portId: `airtable:${baseId}`,
      provenance: "PRODUCTION",
      baseId,
      tableName: "HOUSEHOLD EVENTS",
      // One verb. A real transport must POST a new record and nothing else.
      append: (record) => transport(record),
    },
  };
}
