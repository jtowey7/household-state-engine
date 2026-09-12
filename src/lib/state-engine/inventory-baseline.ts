import { classifyEvidencePrecision } from "./evidence-precision";
import { hashOf } from "./hash";
import type { EvidencePrecision, HouseholdEvent } from "./types";

export interface InventoryBaselineRow {
  recordId: string;
  item: string;
  quantity: number | null | undefined;
  unit?: string | null | undefined;
  status?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface BaselineException {
  recordId: string;
  code:
    | "MISSING_ITEM"
    | "MISSING_QUANTITY"
    | "INVALID_QUANTITY"
    | "OUT_OF_STOCK"
    | "DUPLICATE_SOURCE_RECORD"
    | "QUALIFIED_AMBIGUOUS_EVIDENCE";
  detail: string;
}

export interface InventoryBaseline {
  baselineTimestamp: string;
  source: "INVENTORY_SNAPSHOT";
  events: HouseholdEvent[];
  exceptions: BaselineException[];
  sourceRecordIds: string[];
  baselineId: string;
}

export interface InventoryBaselineAudit {
  baselineId: string;
  baselineTimestamp: string;
  source: "INVENTORY_SNAPSHOT";
  totalRows: number;
  uniqueSourceRecordIds: number;
  duplicateSourceRecordIds: number;
  eligibleRows: number;
  qualifiedAmbiguousRows: number;
  eventCount: number;
  itemUnitGroupCount: number;
  qualifiedAmbiguousItemUnitGroupCount: number;
  exceptionCount: number;
  exceptionsByCode: Record<BaselineException["code"], number>;
  unitGroups: string[];
  readyForAuthority: boolean;
  readinessReason: string;
}

function assertBaselineTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid baseline timestamp: ${value}`);
  }
}

interface CandidateGroup {
  itemKey: string;
  unit?: string;
  quantity: number;
  evidencePrecision: EvidencePrecision;
  sourceRecordIds: string[];
}

export function buildInventoryBaseline(
  rows: readonly InventoryBaselineRow[],
  baselineTimestamp: string,
): InventoryBaseline {
  assertBaselineTimestamp(baselineTimestamp);

  const events: HouseholdEvent[] = [];
  const exceptions: BaselineException[] = [];
  const sourceRecordIds: string[] = [];
  const groups = new Map<string, CandidateGroup>();
  const seenRecordIds = new Set<string>();

  for (const row of rows) {
    const recordId = row.recordId.trim();
    const itemKey = row.item.trim();
    sourceRecordIds.push(recordId);

    if (!recordId || !itemKey) continue;
    if (seenRecordIds.has(recordId)) continue;
    seenRecordIds.add(recordId);
    if ((row.status ?? "").trim().toLowerCase() === "out") continue;
    if (row.quantity === null || row.quantity === undefined) continue;
    if (!Number.isFinite(row.quantity) || row.quantity < 0) continue;

    const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : undefined;
    const evidencePrecision = classifyEvidencePrecision(row.notes);
    const key = `${itemKey}\u0000${unit ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.evidencePrecision =
        existing.evidencePrecision === "QUALIFIED_AMBIGUOUS" || evidencePrecision === "QUALIFIED_AMBIGUOUS"
          ? "QUALIFIED_AMBIGUOUS"
          : "EXACT";
      existing.sourceRecordIds.push(recordId);
    } else {
      groups.set(key, {
        itemKey,
        ...(unit ? { unit } : {}),
        quantity: row.quantity,
        evidencePrecision,
        sourceRecordIds: [recordId],
      });
    }
  }

  const validatedRecordIds = new Set<string>();
  for (const row of rows) {
    const recordId = row.recordId.trim();
    const itemKey = row.item.trim();

    if (!recordId) {
      exceptions.push({ recordId: row.recordId, code: "MISSING_ITEM", detail: "Inventory record has no stable source record ID; refusing to create a baseline event." });
      continue;
    }
    if (validatedRecordIds.has(recordId)) {
      exceptions.push({ recordId, code: "DUPLICATE_SOURCE_RECORD", detail: "The same source record ID appeared more than once in the inventory snapshot; refusing to count it twice." });
      continue;
    }
    validatedRecordIds.add(recordId);

    if (!itemKey) {
      exceptions.push({ recordId, code: "MISSING_ITEM", detail: "Inventory item is blank; refusing to create a baseline event." });
      continue;
    }
    if ((row.status ?? "").trim().toLowerCase() === "out") {
      exceptions.push({ recordId, code: "OUT_OF_STOCK", detail: "Status=Out is excluded from the current-stock baseline." });
      continue;
    }
    if (row.quantity === null || row.quantity === undefined) {
      exceptions.push({ recordId, code: "MISSING_QUANTITY", detail: "Inventory quantity is blank; row requires explicit reconciliation before baseline inclusion." });
      continue;
    }
    if (!Number.isFinite(row.quantity) || row.quantity < 0) {
      exceptions.push({ recordId, code: "INVALID_QUANTITY", detail: `Inventory quantity ${String(row.quantity)} is invalid for a stock baseline.` });
      continue;
    }
    if (classifyEvidencePrecision(row.notes) === "QUALIFIED_AMBIGUOUS") {
      exceptions.push({ recordId, code: "QUALIFIED_AMBIGUOUS_EVIDENCE", detail: "Numeric inventory quantity is qualified by the source notes; explicit reconciliation is required before baseline readiness." });
    }
  }

  const orderedExceptions = [...exceptions].sort((a, b) =>
    `${a.recordId}\u0000${a.code}\u0000${a.detail}`.localeCompare(`${b.recordId}\u0000${b.code}\u0000${b.detail}`),
  );

  for (const group of [...groups.values()].sort((a, b) =>
    `${a.itemKey}\u0000${a.unit ?? ""}`.localeCompare(`${b.itemKey}\u0000${b.unit ?? ""}`),
  )) {
    const sourceIds = [...group.sourceRecordIds].sort();
    const eventIdentity = {
      itemKey: group.itemKey,
      unit: group.unit ?? "",
      quantity: group.quantity,
      evidencePrecision: group.evidencePrecision,
      sourceRecordIds: sourceIds,
    };
    const eventId = `BASELINE:${hashOf(eventIdentity)}`;
    events.push({
      eventId,
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: group.itemKey,
      occurredAt: baselineTimestamp,
      payload: {
        quantity: group.quantity,
        ...(group.unit ? { unit: group.unit } : {}),
        evidencePrecision: group.evidencePrecision,
        note: `source=INVENTORY_SNAPSHOT;sourceRecordIds=${sourceIds.join(",")};baselineTimestamp=${baselineTimestamp}`,
      },
    });
  }

  const baselineId = hashOf({
    source: "INVENTORY_SNAPSHOT",
    sourceRecordIds: [...sourceRecordIds].sort(),
    events: events.map((event) => ({
      eventId: event.eventId,
      itemKey: event.itemKey,
      payload: {
        quantity: event.payload.quantity,
        unit: event.payload.unit ?? "",
        evidencePrecision: event.payload.evidencePrecision,
        noteSourceRecordIds: typeof event.payload.note === "string"
          ? event.payload.note.match(/sourceRecordIds=([^;]+)/)?.[1] ?? ""
          : "",
      },
    })),
    exceptions: orderedExceptions,
  });

  return {
    baselineTimestamp,
    source: "INVENTORY_SNAPSHOT",
    events,
    exceptions: orderedExceptions,
    sourceRecordIds: [...sourceRecordIds].sort(),
    baselineId,
  };
}

export function auditInventoryBaseline(
  rows: readonly InventoryBaselineRow[],
  baseline: InventoryBaseline,
): InventoryBaselineAudit {
  const uniqueSourceRecordIds = new Set(rows.map((row) => row.recordId.trim()).filter(Boolean)).size;
  const duplicateSourceRecordIds = baseline.exceptions.filter((exception) => exception.code === "DUPLICATE_SOURCE_RECORD").length;

  const exceptionsByCode: Record<BaselineException["code"], number> = {
    MISSING_ITEM: 0,
    MISSING_QUANTITY: 0,
    INVALID_QUANTITY: 0,
    OUT_OF_STOCK: 0,
    DUPLICATE_SOURCE_RECORD: 0,
    QUALIFIED_AMBIGUOUS_EVIDENCE: 0,
  };
  for (const exception of baseline.exceptions) exceptionsByCode[exception.code] += 1;

  const unitGroups = [...new Set(
    baseline.events.map((event) => {
      const unit = typeof event.payload.unit === "string" ? event.payload.unit : "";
      return `${event.itemKey}\u0000${unit}`;
    }),
  )].sort();

  const eligibleRows = baseline.events.reduce((total, event) => {
    const note = typeof event.payload.note === "string" ? event.payload.note : "";
    const sourceIds = note.match(/sourceRecordIds=([^;]+)/)?.[1];
    return total + (sourceIds ? sourceIds.split(",").filter(Boolean).length : 0);
  }, 0);

  const qualifiedAmbiguousRows = baseline.exceptions.filter((exception) => exception.code === "QUALIFIED_AMBIGUOUS_EVIDENCE").length;
  const qualifiedAmbiguousItemUnitGroupCount = baseline.events.filter((event) => event.payload.evidencePrecision === "QUALIFIED_AMBIGUOUS").length;
  const readyForAuthority = baseline.exceptions.length === 0;

  return {
    baselineId: baseline.baselineId,
    baselineTimestamp: baseline.baselineTimestamp,
    source: baseline.source,
    totalRows: rows.length,
    uniqueSourceRecordIds,
    duplicateSourceRecordIds,
    eligibleRows,
    qualifiedAmbiguousRows,
    eventCount: baseline.events.length,
    itemUnitGroupCount: unitGroups.length,
    qualifiedAmbiguousItemUnitGroupCount,
    exceptionCount: baseline.exceptions.length,
    exceptionsByCode,
    unitGroups,
    readyForAuthority,
    readinessReason: readyForAuthority
      ? "Snapshot has no baseline exceptions; it is structurally ready for separate Production authority review."
      : `${baseline.exceptions.length} snapshot exception(s) require explicit reconciliation before Production baseline authority can be exercised.`,
  };
}
