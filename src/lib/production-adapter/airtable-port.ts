/**
 * Food OS — Airtable HOUSEHOLD EVENTS read-only port (connector-agnostic).
 *
 * Status: there is still NO live Airtable connection for this project, so
 * nothing here reads real household state. What this file provides is the
 * production-shaped boundary a read-only connector plugs into later:
 *
 *   AirtableRowSource (read-only fetch boundary)
 *     -> mapHouseholdEventRow (strict mapping of the REAL field contract)
 *       -> ProductionStatePort (contract-tested, write-refusing)
 *
 * Source-of-truth boundary: HOUSEHOLD EVENTS is the *state* source only. It
 * does NOT supply demand targets / par levels — there is no PAR LEVELS table in
 * the real base, and weekly meal/quantity planning supplies targets downstream.
 *
 * Real HOUSEHOLD EVENTS fields (verbatim):
 *   Event ID, Event type, Occurred at, Recorded at, Source, Actor, Entity type,
 *   Entity reference, Item, Quantity delta, Unit, Evidence, State before,
 *   State after, Confidence, Supersedes event ID,
 *   Exception / reconciliation action, Replay status, Record class
 *
 * Real "Event type" choices: Delivery, Receipt, Consumption, Correction,
 * Confirmation, Disposal, Transfer, Substitution, Unavailable, Other.
 * Real "Record class" choices: Production, Test.
 *
 * Safety properties enforced here:
 * - the source interface has NO create/update/delete member, and
 *   `assertReadOnlySource` refuses any object that exposes one;
 * - the immutable Event ID comes from the `Event ID` field verbatim — the
 *   Airtable record id (rec…) is never used as an Event ID;
 * - only deterministically representable event types become stock changes;
 *   Confirmation / Transfer / Substitution / Unavailable / Other are preserved
 *   as explicit unsupported source records, never as silent stock changes;
 * - quantities and units are never invented; a missing one is a rejection;
 * - `Record class` is preserved verbatim so the State Engine excludes Test;
 * - `Supersedes event ID` is carried through so supersession stays authoritative;
 * - legacy/invented field names (Item Key, Quantity, Note, Supersedes,
 *   Event Type) are explicitly rejected rather than accidentally accepted.
 */

import type { HouseholdEvent, RecordClass } from "../state-engine/types";
import type {
  ProductionReadResult,
  ProductionStatePort,
  SourceMode,
  SourceRejection,
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
  /** HOUSEHOLD EVENTS rows only. No target/par-level table is read. */
  listEventRows(scope: SourceScope): Promise<AirtableRow[]>;
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

/** The exact HOUSEHOLD EVENTS field names. Nothing else is read. */
export const HOUSEHOLD_EVENT_FIELDS = [
  "Event ID",
  "Event type",
  "Occurred at",
  "Recorded at",
  "Source",
  "Actor",
  "Entity type",
  "Entity reference",
  "Item",
  "Quantity delta",
  "Unit",
  "Evidence",
  "State before",
  "State after",
  "Confidence",
  "Supersedes event ID",
  "Exception / reconciliation action",
  "Replay status",
  "Record class",
] as const;

/** Invented names used by the previous mapper. Presence of these is a schema error. */
export const LEGACY_FIELD_NAMES = [
  "Item Key",
  "Quantity",
  "Note",
  "Supersedes",
  "Event Type",
  "Occurred At",
  "Record Class",
] as const;

export type AirtableEventType =
  | "Delivery"
  | "Receipt"
  | "Consumption"
  | "Correction"
  | "Confirmation"
  | "Disposal"
  | "Transfer"
  | "Substitution"
  | "Unavailable"
  | "Other";

const AIRTABLE_EVENT_TYPES: AirtableEventType[] = [
  "Delivery",
  "Receipt",
  "Consumption",
  "Correction",
  "Confirmation",
  "Disposal",
  "Transfer",
  "Substitution",
  "Unavailable",
  "Other",
];

/** Increase stock. */
const INBOUND: AirtableEventType[] = ["Delivery", "Receipt"];
/** Decrease stock. */
const OUTBOUND: AirtableEventType[] = ["Consumption", "Disposal"];
/** Never a deterministic stock change — kept as explicit source records. */
const NON_STOCK: AirtableEventType[] = [
  "Confirmation",
  "Transfer",
  "Substitution",
  "Unavailable",
  "Other",
];

export type EventRowRejectionCode =
  | "LEGACY_FIELD_SCHEMA"
  | "MISSING_EVENT_ID"
  | "MISSING_ITEM"
  | "MISSING_OCCURRED_AT"
  | "INVALID_EVENT_TYPE"
  | "INVALID_RECORD_CLASS"
  | "MISSING_QUANTITY_DELTA"
  | "MISSING_UNIT"
  | "UNMAPPABLE_CORRECTION"
  | "UNSUPPORTED_EVENT_TYPE";

/** Everything the Airtable row carried that is provenance, not state. */
export interface EventProvenance {
  airtableRecordId: string;
  eventTypeRaw: string;
  recordedAt: string | null;
  source: string | null;
  actor: string | null;
  entityType: string | null;
  entityReference: string | null;
  evidence: string | null;
  stateBefore: string | null;
  stateAfter: string | null;
  confidence: string | null;
  exceptionAction: string | null;
  replayStatus: string | null;
  supersedesEventId: string[];
}

export interface MappedEventRecord {
  event: HouseholdEvent;
  provenance: EventProvenance;
}

export interface UnmappedEventRecord {
  code: EventRowRejectionCode;
  /** UNSUPPORTED rows are informational; INVALID rows quarantine their item. */
  kind: "UNSUPPORTED" | "INVALID";
  eventId: string | null;
  itemKey: string | null;
  airtableRecordId: string;
  eventTypeRaw: string | null;
  detail: string;
  provenance: EventProvenance | null;
}

export type EventRowMapping =
  | ({ ok: true } & MappedEventRecord)
  | ({ ok: false } & UnmappedEventRecord);

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim().length > 0);
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : null))
      .filter((v): v is string => !!v);
  }
  const single = typeof value === "string" ? value.trim() : "";
  return single ? single.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function provenanceOf(row: AirtableRow): EventProvenance {
  const f = row.fields;
  return {
    airtableRecordId: row.id,
    eventTypeRaw: str(f["Event type"]) ?? "",
    recordedAt: str(f["Recorded at"]),
    source: str(f["Source"]),
    actor: str(f["Actor"]),
    entityType: str(f["Entity type"]),
    entityReference: str(f["Entity reference"]),
    evidence: str(f["Evidence"]),
    stateBefore: str(f["State before"]),
    stateAfter: str(f["State after"]),
    confidence: str(f["Confidence"]),
    exceptionAction: str(f["Exception / reconciliation action"]),
    replayStatus: str(f["Replay status"]),
    supersedesEventId: list(f["Supersedes event ID"]),
  };
}

/**
 * Maps ONE real HOUSEHOLD EVENTS row into the canonical State Engine model.
 * Never throws, never guesses: an unusable row comes back as `ok: false` with
 * an explicit code so the caller can isolate exactly that row.
 */
export function mapHouseholdEventRow(row: AirtableRow): EventRowMapping {
  const f = row.fields ?? {};
  const fail = (
    code: EventRowRejectionCode,
    kind: "UNSUPPORTED" | "INVALID",
    detail: string,
  ): EventRowMapping => ({
    ok: false,
    code,
    kind,
    eventId: str(f["Event ID"]),
    itemKey: str(f["Item"]),
    airtableRecordId: row.id,
    eventTypeRaw: str(f["Event type"]),
    detail,
    provenance: provenanceOf(row),
  });

  const legacy = LEGACY_FIELD_NAMES.filter((name) => name in f);
  const hasRealSchema = "Event ID" in f && "Event type" in f && "Record class" in f;
  if (legacy.length > 0 && !hasRealSchema) {
    return fail(
      "LEGACY_FIELD_SCHEMA",
      "INVALID",
      `Row uses invented field names (${legacy.join(", ")}) and not the real HOUSEHOLD EVENTS contract; refused.`,
    );
  }

  const eventId = str(f["Event ID"]);
  if (!eventId) return fail("MISSING_EVENT_ID", "INVALID", "Row has no immutable `Event ID`.");

  const rawType = str(f["Event type"]);
  if (!rawType || !AIRTABLE_EVENT_TYPES.includes(rawType as AirtableEventType)) {
    return fail(
      "INVALID_EVENT_TYPE",
      "INVALID",
      `\`Event type\` "${rawType ?? ""}" is not one of the real choices.`,
    );
  }
  const eventType = rawType as AirtableEventType;

  const rawClass = str(f["Record class"]);
  if (rawClass !== "Production" && rawClass !== "Test") {
    return fail(
      "INVALID_RECORD_CLASS",
      "INVALID",
      `\`Record class\` must be Production or Test, received "${rawClass ?? ""}".`,
    );
  }
  const recordClass: RecordClass = rawClass;

  if (NON_STOCK.includes(eventType)) {
    return fail(
      "UNSUPPORTED_EVENT_TYPE",
      "UNSUPPORTED",
      `\`${eventType}\` is not a deterministic stock change; preserved as a source record only.`,
    );
  }

  const itemKey = str(f["Item"]);
  if (!itemKey) return fail("MISSING_ITEM", "INVALID", "Row has no `Item`.");

  const occurredAt = str(f["Occurred at"]);
  if (!occurredAt) return fail("MISSING_OCCURRED_AT", "INVALID", "Row has no `Occurred at`.");

  const unit = str(f["Unit"]);
  const delta = num(f["Quantity delta"]);
  const provenance = provenanceOf(row);
  const supersedes = provenance.supersedesEventId;

  const build = (
    kind: HouseholdEvent["eventType"],
    quantity: number,
    resolvedUnit: string,
  ): EventRowMapping => ({
    ok: true,
    event: {
      eventId,
      recordClass,
      eventType: kind,
      itemKey,
      occurredAt,
      payload: { quantity, unit: resolvedUnit },
      ...(supersedes.length > 0 ? { supersedes } : {}),
    },
    provenance,
  });

  if (eventType === "Correction") {
    // Only the state-after semantics the runtime can represent are mapped.
    const stateAfter = num(f["State after"]);
    if (stateAfter === null) {
      return fail(
        "UNMAPPABLE_CORRECTION",
        "INVALID",
        "Correction carries no numeric `State after`; the runtime cannot derive an absolute state.",
      );
    }
    if (!unit) return fail("MISSING_UNIT", "INVALID", "Correction has `State after` but no `Unit`.");
    return build("ITEM_STOCK_SET", stateAfter, unit);
  }

  if (delta === null) {
    return fail(
      "MISSING_QUANTITY_DELTA",
      "INVALID",
      `${eventType} has no numeric \`Quantity delta\`; quantities are never invented.`,
    );
  }
  if (!unit) {
    return fail("MISSING_UNIT", "INVALID", `${eventType} has a quantity but no \`Unit\`.`);
  }
  if (delta === 0) {
    return fail(
      "MISSING_QUANTITY_DELTA",
      "INVALID",
      `${eventType} has a zero \`Quantity delta\`; no state change can be derived.`,
    );
  }

  const magnitude = Math.abs(delta);
  const signed = INBOUND.includes(eventType) ? magnitude : -magnitude;
  return build("ITEM_STOCK_DELTA", signed, unit);
}

export interface MappedEventBatch {
  events: HouseholdEvent[];
  /** Provenance for every mapped event, keyed by Event ID. */
  provenance: Record<string, EventProvenance>;
  /** Rows deliberately not converted to stock changes (Confirmation, etc.). */
  unsupported: UnmappedEventRecord[];
  /** Structurally unusable rows. Their item is quarantined downstream. */
  invalid: UnmappedEventRecord[];
}

export function mapHouseholdEventRows(rows: AirtableRow[]): MappedEventBatch {
  const batch: MappedEventBatch = {
    events: [],
    provenance: {},
    unsupported: [],
    invalid: [],
  };
  for (const row of rows) {
    const mapped = mapHouseholdEventRow(row);
    if (mapped.ok) {
      batch.events.push(mapped.event);
      batch.provenance[mapped.event.eventId] = mapped.provenance;
    } else if (mapped.kind === "UNSUPPORTED") {
      batch.unsupported.push(mapped);
    } else {
      batch.invalid.push(mapped);
    }
  }
  return batch;
}

function toRejection(record: UnmappedEventRecord): SourceRejection {
  return {
    code:
      record.kind === "UNSUPPORTED"
        ? "UNSUPPORTED_EVENT_TYPE"
        : record.code === "LEGACY_FIELD_SCHEMA"
          ? "LEGACY_FIELD_SCHEMA"
          : "MALFORMED_EVENT",
    itemKey: record.itemKey,
    eventId: record.eventId,
    detail: `${record.code} (${record.airtableRecordId}): ${record.detail}`,
    fatal: false,
    /** UNSUPPORTED rows are informational and must not quarantine the item. */
    quarantines: record.kind === "INVALID",
  };
}

export interface AirtablePortConfig {
  source: AirtableRowSource;
  /** Defaults to PRODUCTION_READ_ONLY; a fake source must declare SYNTHETIC. */
  mode?: SourceMode;
  portId?: string;
}

/**
 * Builds the read-only ProductionStatePort. The returned object has `read` and
 * nothing else — there is no code path from the runtime back into Airtable, and
 * it returns household events only (never demand targets).
 */
export function createAirtableProductionPort(config: AirtablePortConfig): ProductionStatePort {
  assertReadOnlySource(config.source);
  const mode: SourceMode = config.mode ?? "PRODUCTION_READ_ONLY";
  return {
    portId: config.portId ?? `airtable:${config.source.baseLabel}`,
    mode,
    async read(scope: SourceScope): Promise<ProductionReadResult> {
      const rows = await config.source.listEventRows(scope);
      const batch = mapHouseholdEventRows(rows);
      return {
        openingEvents: batch.events,
        eventProvenance: batch.provenance,
        rejections: [...batch.unsupported, ...batch.invalid].map(toRejection),
        provenance: config.source.provenance,
        claimedMode: mode,
      };
    },
  };
}

export interface FakeAirtableConfig {
  eventRows: AirtableRow[];
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
  return {
    baseLabel: config.baseLabel ?? "food-os-fake",
    provenance: config.provenance ?? "synthetic fixture — fake Airtable row source",
    async listEventRows() {
      if (config.failWith) throw new Error(config.failWith);
      return config.eventRows;
    },
  };
}
