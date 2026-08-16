import {
  assertReadOnlySource,
  type AirtablePortConfig,
} from "./airtable-port";
import { mapHouseholdEventRowsWithEvidencePrecision } from "./evidence-aware-mapper";
import type { ProductionReadResult, ProductionStatePort, SourceScope } from "./types";

/**
 * Production read port that preserves source Evidence precision at the real
 * Airtable adapter boundary. The underlying source remains read-only; this
 * wrapper changes no quantity/state semantics and never invents evidence.
 */
export function createEvidenceAwareAirtableProductionPort(
  config: AirtablePortConfig,
): ProductionStatePort {
  assertReadOnlySource(config.source);
  const mode = config.mode ?? "PRODUCTION_READ_ONLY";
  return {
    portId: config.portId ?? `airtable:evidence-aware:${config.source.baseLabel}`,
    mode,
    async read(scope: SourceScope): Promise<ProductionReadResult> {
      const rows = await config.source.listEventRows(scope);
      const mapped = mapHouseholdEventRowsWithEvidencePrecision(rows);
      const openingEvents = mapped.filter((row) => row.ok).map((row) => row.event);
      const eventProvenance = Object.fromEntries(
        mapped.filter((row) => row.ok).map((row) => [row.event.eventId, row.provenance]),
      );
      const rejections = mapped.filter((row) => !row.ok).map((row) => ({
        code: row.kind === "UNSUPPORTED" ? "UNSUPPORTED_EVENT_TYPE" as const : row.code === "LEGACY_FIELD_SCHEMA" ? "LEGACY_FIELD_SCHEMA" as const : "MALFORMED_EVENT" as const,
        itemKey: row.itemKey,
        eventId: row.eventId,
        detail: `${row.code} (${row.airtableRecordId}): ${row.detail}`,
        fatal: false,
        quarantines: row.kind === "INVALID",
      }));
      return {
        openingEvents,
        eventProvenance,
        rejections,
        provenance: config.source.provenance,
        claimedMode: mode,
      };
    },
  };
}
