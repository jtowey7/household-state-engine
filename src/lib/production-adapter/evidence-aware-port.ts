import { assertReadOnlySource } from "./airtable-port";
import { mapHouseholdEventRowsWithEvidencePrecision } from "./evidence-aware-mapper";
import type { AirtableRowSource } from "./airtable-port";
import type { ProductionReadResult, ProductionStatePort, SourceMode, SourceScope } from "./types";

/**
 * Production read port that preserves source Evidence qualification before
 * events reach the State Engine. This is deliberately a separate wrapper so
 * the strict base mapper remains reusable for low-level contract tests.
 *
 * It is read-only by construction: the source exposes only listEventRows and
 * the returned port exposes only read.
 */
export interface EvidenceAwareAirtablePortConfig {
  source: AirtableRowSource;
  mode?: SourceMode;
  portId?: string;
}

export function createEvidenceAwareAirtableProductionPort(
  config: EvidenceAwareAirtablePortConfig,
): ProductionStatePort {
  assertReadOnlySource(config.source);
  const mode: SourceMode = config.mode ?? "PRODUCTION_READ_ONLY";

  return {
    portId: config.portId ?? `airtable-evidence-aware:${config.source.baseLabel}`,
    mode,
    async read(scope: SourceScope): Promise<ProductionReadResult> {
      const rows = await config.source.listEventRows(scope);
      const mapped = mapHouseholdEventRowsWithEvidencePrecision(rows);
      type UnmappedRow = Extract<(typeof mapped)[number], { ok: false }>;
      const invalid = mapped.filter((result): result is UnmappedRow => !result.ok && result.kind === "INVALID");
      const unsupported = mapped.filter((result): result is UnmappedRow => !result.ok && result.kind === "UNSUPPORTED");

      return {
        openingEvents: mapped.filter((result): result is Extract<typeof result, { ok: true }> => result.ok).map((result) => result.event),
        eventProvenance: Object.fromEntries(
          mapped
            .filter((result): result is Extract<typeof result, { ok: true }> => result.ok)
            .map((result) => [result.event.eventId, result.provenance]),
        ),
        rejections: [
          ...unsupported.map((record) => ({
            code: "UNSUPPORTED_EVENT_TYPE" as const,
            itemKey: record.itemKey,
            eventId: record.eventId,
            detail: `${record.code} (${record.airtableRecordId}): ${record.detail}`,
            fatal: false,
            quarantines: false,
          })),
          ...invalid.map((record) => ({
            code: record.code === "LEGACY_FIELD_SCHEMA" ? ("LEGACY_FIELD_SCHEMA" as const) : ("MALFORMED_EVENT" as const),
            itemKey: record.itemKey,
            eventId: record.eventId,
            detail: `${record.code} (${record.airtableRecordId}): ${record.detail}`,
            fatal: false,
            quarantines: true,
          })),
        ],
        provenance: config.source.provenance,
        claimedMode: mode,
      };
    },
  };
}
