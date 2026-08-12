/**
 * Food OS — Airtable-backed production-state port (READ-ONLY, connector-agnostic).
 *
 * Status: no Airtable connection exists for this project yet (the workspace has
 * no Airtable connection), so nothing here talks to a live base. What this file
 * provides is the production-shaped boundary that a real connector plugs into
 * without touching the runtime:
 *
 *   AirtableRowSource (read-only fetch boundary)
 *     -> mapEventRow / mapTargetRow (strict field mapping)
 *       -> ProductionStatePort (contract-tested, write-refusing)
 *
 * Safety properties enforced here:
 * - the source interface has NO create/update/delete member, and
 *   `assertReadOnlySource` refuses any object that exposes one;
 * - immutable Event IDs come from the row verbatim — never generated;
 * - canonical payload fields are mapped explicitly (no blind spread), so an
 *   unknown Airtable column can never silently alter event identity;
 * - Record Class = Test is preserved verbatim so the State Engine can exclude
 *   it; the adapter never rewrites the class;
 * - `Supersedes` is carried through so supersession stays authoritative;
 * - structurally bad rows are surfaced as unusable rows and quarantined by
 *   `loadProductionState` — they are never repaired or guessed.
 */

import type { HouseholdEvent, EventType, RecordClass } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type {
  ProductionReadResult,
  ProductionStatePort,
  SourceMode,
  SourceScope,
} from "./types";

export interface AirtableRow {
  /** Airtable record id (rec…). Never used as the Event ID. */
  id: string;
  fields: Record<string, unknown>;
}

/** Read-only fetch boundary. A real connector implements exactly this. */
export interface AirtableRowSource {
  readonly baseLabel: string;
  readonly provenance: string;
  listEventRows(scope: SourceScope): Promise<AirtableRow[]>;
  listTargetRows(scope: SourceScope): Promise<AirtableRow[]>;
}

const WRITE_MEMBERS = [
  "create",
  "createRecords",
  "update",
  "updateRecords",
  "patch",
  "put",
  "destroy",
  "delete",
  "deleteRecords",
  "replace",
  "upsert",
];

/** Refuses any source object that exposes a mutation method. */
export function assertReadOnlySource(source: object): void {
  const offending = WRITE_MEMBERS.filter(
    (m) => typeof (source as Record<string, unknown>)[m] === "function",
  );
  if (offending.length > 0) {
    throw new Error(
      `Airtable source exposes write members (${offending.join(", ")}); read-only port refuses it.`,
    );
  }
}

const EVENT_TYPES: EventType[] = ["ITEM_STOCK_SET", "ITEM_STOCK_DELTA", "ITEM_REMOVED"];

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).filter((v): v is string => v !== null);
  const single = str(value);
  return single ? single.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Maps one HOUSEHOLD EVENTS row. Returns a structurally invalid event (empty
 * required fields) rather than throwing, so `loadProductionState` quarantines
 * only that item instead of failing the whole read.
 */
export function mapEventRow(row: AirtableRow): HouseholdEvent {
  const f = row.fields;
  const eventId = str(f["Event ID"]) ?? "";
  const itemKey = str(f["Item Key"]) ?? "";
  const rawType = str(f["Event Type"]) ?? "";
  const eventType = (EVENT_TYPES as string[]).includes(rawType)
    ? (rawType as EventType)
    : ("" as EventType);
  const recordClass: RecordClass = str(f["Record Class"]) === "Test" ? "Test" : "Production";
  const quantity = num(f["Quantity"]);
  const unit = str(f["Unit"]);
  const note = str(f["Note"]);
  const supersedes = list(f["Supersedes"]);

  const event: HouseholdEvent = {
    eventId,
    recordClass,
    eventType,
    itemKey,
    occurredAt: str(f["Occurred At"]) ?? "",
    payload: {
      ...(quantity !== null ? { quantity } : {}),
      ...(unit !== null ? { unit } : {}),
      ...(note !== null ? { note } : {}),
    },
    ...(supersedes.length > 0 ? { supersedes } : {}),
  };
  return event;
}

/** Maps one PAR LEVELS / demand-target row. Invalid rows are quarantined downstream. */
export function mapTargetRow(row: AirtableRow): DemandTarget {
  const f = row.fields;
  const packSize = num(f["Pack Size"]);
  const packUnit = str(f["Pack Unit"]);
  return {
    itemKey: str(f["Item Key"]) ?? "",
    targetQuantity: num(f["Target Quantity"]) ?? 0,
    unit: str(f["Unit"]) ?? "",
    ...(packSize !== null ? { packSize } : {}),
    ...(packUnit !== null ? { packUnit } : {}),
  };
}

export interface AirtablePortConfig {
  source: AirtableRowSource;
  /** Defaults to PRODUCTION_READ_ONLY; a fake source should declare SYNTHETIC. */
  mode?: SourceMode;
  portId?: string;
}

/**
 * Builds the read-only ProductionStatePort. The returned object has `read` and
 * nothing else — there is no code path from the runtime back into Airtable.
 */
export function createAirtableProductionPort(config: AirtablePortConfig): ProductionStatePort {
  assertReadOnlySource(config.source);
  const mode: SourceMode = config.mode ?? "PRODUCTION_READ_ONLY";
  return {
    portId: config.portId ?? `airtable:${config.source.baseLabel}`,
    mode,
    async read(scope: SourceScope): Promise<ProductionReadResult> {
      const [eventRows, targetRows] = await Promise.all([
        config.source.listEventRows(scope),
        config.source.listTargetRows(scope),
      ]);
      return {
        openingEvents: eventRows.map(mapEventRow),
        targets: targetRows.map(mapTargetRow),
        provenance: config.source.provenance,
        claimedMode: mode,
      };
    },
  };
}

export interface FakeAirtableConfig {
  eventRows: AirtableRow[];
  targetRows: AirtableRow[];
  baseLabel?: string;
  provenance?: string;
  failWith?: string;
}

/**
 * Fake row source used by the contract tests. It stands in for the real
 * connector and is explicitly labelled synthetic, so the provenance guard
 * refuses to let it masquerade as production state.
 */
export function createFakeAirtableRowSource(config: FakeAirtableConfig): AirtableRowSource {
  const fail = () => {
    if (config.failWith) throw new Error(config.failWith);
  };
  return {
    baseLabel: config.baseLabel ?? "food-os-fake",
    provenance: config.provenance ?? "synthetic fixture — fake Airtable row source",
    async listEventRows() {
      fail();
      return config.eventRows;
    },
    async listTargetRows() {
      fail();
      return config.targetRows;
    },
  };
}
