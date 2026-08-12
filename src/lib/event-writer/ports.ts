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

export interface FakeAppendPort extends ProductionEventAppendPort {
  readonly provenance: "SYNTHETIC";
  /** Rows this double accepted, in order. Test inspection only. */
  readonly appended: CanonicalAppendRecord[];
}

export function createFakeAppendPort(options: { portId?: string; failWith?: string } = {}): FakeAppendPort {
  const appended: CanonicalAppendRecord[] = [];
  return {
    portId: options.portId ?? "fake-append-port",
    provenance: "SYNTHETIC",
    appended,
    async appendEvent(record) {
      if (options.failWith) throw new Error(options.failWith);
      appended.push(record);
      return {
        connectorRecordId: `synthetic-${appended.length}`,
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
      appendEvent: (record) => transport(record),
    },
  };
}
